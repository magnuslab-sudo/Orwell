import { describe, expect, it } from "vitest"
import { IRREVERSIBLE_POWERS, POWERS, type Power, type Sobreposicao } from "./payload.js"
import {
  alturaDe,
  CARGO_ADMIN,
  CARGO_TODOS,
  type CargoDefinido,
  compararCargos,
  type EstadoDePermissoes,
  fundirCargoAntigo,
  permissoesEm,
  PODERES_DE_TODOS_POR_OMISSAO,
  podeAtribuir,
  podeGerirCargo,
  podeSobrepor,
  sobreposicoesAGuardar,
} from "./permissoes.js"

/**
 * The permissions model without network: `permissoesEm` as single source of truth,
 * the hierarchy, and the escalation cases (giving another more than you have).
 */

const ANA = "@ana:t" // founder
const BRUNO = "@bruno:t" // `guia` (rank 2) with `gerircargos`
const CARLA = "@carla:t" // no role
const DARIO = "@dario:t" // admin
const EVA = "@eva:t" // `porteiro` (rank 1)

function estado(opcoes: {
  cargos?: Record<string, CargoDefinido>
  de?: Record<string, string[]>
  todos?: Power[]
  salas?: Record<string, { categoria?: string; perms?: Sobreposicao[] }>
  categorias?: Record<string, Sobreposicao[]>
  fundador?: string | null
}): EstadoDePermissoes {
  return {
    fundador: opcoes.fundador === undefined ? ANA : opcoes.fundador,
    cargosDe: (address) => opcoes.de?.[address] ?? [],
    cargo: (role) => opcoes.cargos?.[role],
    todos: opcoes.todos ?? PODERES_DE_TODOS_POR_OMISSAO,
    categoriaDaSala: (room) => opcoes.salas?.[room]?.categoria ?? "",
    sobreposicoesDaSala: (room) => opcoes.salas?.[room]?.perms,
    sobreposicoesDaCategoria: (category) => opcoes.categorias?.[category],
  }
}

const base = (): Parameters<typeof estado>[0] => ({
  cargos: {
    guia: { powers: ["mover", "gerircargos", "convidar"], rank: 2 },
    porteiro: { powers: ["convidar"], rank: 1 },
    chefe: { powers: ["expulsar", "gerircargos"], rank: 5 },
  },
  de: { [BRUNO]: ["guia"], [DARIO]: [CARGO_ADMIN], [EVA]: ["porteiro"] },
})

describe("permissoesEm", () => {
  it("a fundadora pode tudo; o admin pode tudo; sem fundação, só o que se desfaz", () => {
    expect(permissoesEm(estado(base()), ANA)).toEqual([...POWERS])
    expect(permissoesEm(estado(base()), DARIO, { sala: "x" })).toEqual([...POWERS])
    expect(permissoesEm(estado({ ...base(), fundador: null }), CARLA)).toEqual(POWERS.filter((p) => !IRREVERSIBLE_POWERS.includes(p)))
  })

  it("quem não tem cargo tem a base de @todos, que por omissão é o que hoje é livre", () => {
    expect(permissoesEm(estado(base()), CARLA)).toEqual(POWERS.filter((p) => PODERES_DE_TODOS_POR_OMISSAO.includes(p)))
    expect(permissoesEm(estado({ ...base(), todos: ["escrever"] }), CARLA)).toEqual(["escrever"])
  })

  it("a migração: um cargo com renomear, mover ou moderar ganha gerirsalas, desligar e apelidos", () => {
    const e = estado({ cargos: { velho: { powers: ["renomear", "mover", "moderar"], rank: 0 } }, de: { [CARLA]: ["velho"] }, todos: [] })
    expect(permissoesEm(e, CARLA)).toEqual(["renomear", "mover", "moderar", "gerirsalas", "desligar", "apelidos"])
  })

  it("um cargo apagado (ou desconhecido) não concede nada", () => {
    expect(permissoesEm(estado({ ...base(), de: { [CARLA]: ["fantasma"] } }), CARLA)).not.toContain("mover")
  })

  it("um cargo com mover numa sala e sem mover noutra", () => {
    const e = estado({
      ...base(),
      salas: {
        arena: { perms: [] },
        estudio: { perms: [{ role: "guia", allow: [], deny: ["mover"] }] },
      },
    })
    expect(permissoesEm(e, BRUNO, { sala: "arena" })).toContain("mover")
    expect(permissoesEm(e, BRUNO, { sala: "estudio" })).not.toContain("mover")
    // A deny on `mover` does not take the implied disconnect if that is stated separately; here it removes only `mover`.
    expect(permissoesEm(e, BRUNO)).toContain("mover")
    expect(permissoesEm(e, CARLA, { sala: "arena" })).not.toContain("mover")
    expect(permissoesEm(e, CARLA, { sala: "estudio" })).not.toContain("mover")
  })

  it("a ordem do Discord: categoria e depois sala; em cada uma, todos e depois os cargos; tirar antes de dar", () => {
    const e = estado({
      ...base(),
      salas: { palco: { categoria: "Jogos", perms: [{ role: CARGO_TODOS, allow: ["ligar"], deny: [] }] } },
      categorias: {
        Jogos: [
          { role: CARGO_TODOS, allow: [], deny: ["ligar", "escrever"] },
          { role: "porteiro", allow: ["escrever"], deny: [] },
        ],
      },
    })
    // Category: everyone loses `ligar` and `escrever`; `porteiro` gets `escrever` back. Room: everyone gets `ligar` back.
    expect(permissoesEm(e, CARLA, { sala: "palco" })).toContain("ligar")
    expect(permissoesEm(e, CARLA, { sala: "palco" })).not.toContain("escrever")
    expect(permissoesEm(e, EVA, { sala: "palco" })).toContain("escrever")
    // In the category, outside the room: `ligar` stays removed.
    expect(permissoesEm(e, CARLA, { categoria: "Jogos" })).not.toContain("ligar")
  })

  it("uma sobreposição não mexe nas permissões do canal inteiro (expulsar, convidar, gerir cargos)", () => {
    const e = estado({ ...base(), salas: { s: { perms: [{ role: CARGO_TODOS, allow: ["expulsar", "gerircargos"], deny: [] }, { role: "guia", allow: [], deny: ["convidar"] }] } } })
    expect(permissoesEm(e, CARLA, { sala: "s" })).not.toContain("expulsar")
    expect(permissoesEm(e, CARLA, { sala: "s" })).not.toContain("gerircargos")
    expect(permissoesEm(e, BRUNO, { sala: "s" })).toContain("convidar")
  })

  it("um nome que esta versão não conhece não se concede", () => {
    const e = estado({ ...base(), salas: { s: { perms: [{ role: CARGO_TODOS, allow: ["teletransporte"], deny: [] }] } } })
    expect(permissoesEm(e, CARLA, { sala: "s" })).not.toContain("teletransporte")
  })
})

describe("hierarquia e escalada", () => {
  it("a altura: fundadora acima de tudo, admin a seguir, depois o rank; sem cargo, -1", () => {
    const e = estado(base())
    expect(alturaDe(e, ANA)).toBe(Number.POSITIVE_INFINITY)
    expect(alturaDe(e, DARIO)).toBe(Number.MAX_SAFE_INTEGER)
    expect(alturaDe(e, BRUNO)).toBe(2)
    expect(alturaDe(e, CARLA)).toBe(-1)
  })

  it("fundadora e admin gerem qualquer cargo, o admin incluído (nome e cor)", () => {
    const e = estado(base())
    for (const quem of [ANA, DARIO]) {
      expect(podeGerirCargo(e, quem, "chefe")).toBe(true)
      expect(podeGerirCargo(e, quem, CARGO_ADMIN)).toBe(true)
      expect(podeGerirCargo(e, quem, CARGO_TODOS)).toBe(true)
    }
  })

  it("o guia (gerircargos, rank 2) gere o porteiro (rank 1) e não o chefe (rank 5) nem o próprio guia", () => {
    const e = estado(base())
    expect(podeGerirCargo(e, BRUNO, "porteiro")).toBe(true)
    expect(podeGerirCargo(e, BRUNO, "chefe")).toBe(false)
    expect(podeGerirCargo(e, BRUNO, "guia")).toBe(false)
    expect(podeGerirCargo(e, BRUNO, CARGO_ADMIN)).toBe(false)
  })

  it("escalada: o guia não dá ao porteiro um poder que não tem (expulsar)", () => {
    const e = estado(base())
    expect(podeGerirCargo(e, BRUNO, "porteiro", { depois: { powers: ["convidar", "mover"], rank: 1 } })).toBe(true)
    expect(podeGerirCargo(e, BRUNO, "porteiro", { depois: { powers: ["convidar", "expulsar"], rank: 1 } })).toBe(false)
  })

  it("escalada: o guia não sobe o porteiro à altura dele nem acima", () => {
    const e = estado(base())
    expect(podeGerirCargo(e, BRUNO, "porteiro", { depois: { powers: ["convidar"], rank: 2 } })).toBe(false)
    expect(podeGerirCargo(e, BRUNO, "novo", { depois: { powers: [], rank: 1 } })).toBe(true)
    expect(podeGerirCargo(e, BRUNO, "novo", { depois: { powers: [], rank: 9 } })).toBe(false)
  })

  it("escalada: o guia não mexe num cargo que hoje tem mais do que ele, mesmo para o reduzir", () => {
    const e = estado({ ...base(), cargos: { ...base().cargos, cofre: { powers: ["expulsar"], rank: 0 } } })
    expect(podeGerirCargo(e, BRUNO, "cofre", { depois: { powers: [], rank: 0 } })).toBe(false)
  })

  it("escalada: @todos só com o que quem muda tem", () => {
    const e = estado({ ...base(), todos: [] })
    expect(podeGerirCargo(e, BRUNO, CARGO_TODOS, { depois: { powers: ["mover"], rank: -1 } })).toBe(true)
    expect(podeGerirCargo(e, BRUNO, CARGO_TODOS, { depois: { powers: ["expulsar"], rank: -1 } })).toBe(false)
  })

  it("sem gerircargos, nada; a porteira não gere ninguém", () => {
    const e = estado(base())
    expect(podeGerirCargo(e, EVA, "porteiro")).toBe(false)
    expect(podeGerirCargo(e, CARLA, "porteiro")).toBe(false)
  })

  it("atribuir: o guia dá e tira o porteiro a quem está abaixo dele", () => {
    const e = estado(base())
    expect(podeAtribuir(e, BRUNO, CARLA, [], ["porteiro"])).toBe(true)
    expect(podeAtribuir(e, BRUNO, EVA, ["porteiro"], [])).toBe(true)
  })

  it("escalada na atribuição: o guia não dá o chefe nem o admin, não toca na fundadora, nem em quem está à altura dele", () => {
    const e = estado({ ...base(), de: { ...base().de, "@fabio:t": ["guia"] } })
    expect(podeAtribuir(e, BRUNO, CARLA, [], ["chefe"])).toBe(false)
    expect(podeAtribuir(e, BRUNO, CARLA, [], [CARGO_ADMIN])).toBe(false)
    expect(podeAtribuir(e, BRUNO, CARLA, [], ["guia"])).toBe(false)
    expect(podeAtribuir(e, BRUNO, ANA, [], ["porteiro"])).toBe(false)
    expect(podeAtribuir(e, BRUNO, "@fabio:t", ["guia"], ["guia", "porteiro"])).toBe(false)
    expect(podeAtribuir(e, BRUNO, DARIO, [CARGO_ADMIN], [])).toBe(false)
    // Not to themselves either: they are at their own rank.
    expect(podeAtribuir(e, BRUNO, BRUNO, ["guia"], ["guia", "porteiro"])).toBe(false)
  })

  it("atribuir: fundadora e admin como sempre; @todos na lista não conta", () => {
    const e = estado(base())
    expect(podeAtribuir(e, ANA, BRUNO, ["guia"], ["chefe", CARGO_ADMIN])).toBe(true)
    expect(podeAtribuir(e, DARIO, CARLA, [], ["chefe"])).toBe(true)
    expect(podeAtribuir(e, BRUNO, CARLA, [], [CARGO_TODOS, "porteiro"])).toBe(true)
  })

  it("num canal sem fundação, ninguém atribui nem gere por delegação", () => {
    const e = estado({ ...base(), fundador: null })
    expect(podeGerirCargo(e, BRUNO, "porteiro")).toBe(false)
    expect(podeAtribuir(e, BRUNO, CARLA, [], ["porteiro"])).toBe(false)
  })
})

describe("sobreposições: quem as pode mudar", () => {
  const comSalas = (): Parameters<typeof estado>[0] => ({
    ...base(),
    cargos: { ...base().cargos, arrumador: { powers: ["gerirsalas", "mover"], rank: 3 } },
    de: { ...base().de, [CARLA]: ["arrumador"] },
  })

  it("fundadora e admin: sim; quem não tem gerirsalas: não", () => {
    const e = estado(comSalas())
    const nova = [{ role: "guia", allow: [], deny: ["mover"] }]
    expect(podeSobrepor(e, ANA, { sala: "s" }, undefined, nova)).toBe(true)
    expect(podeSobrepor(e, DARIO, { sala: "s" }, undefined, nova)).toBe(true)
    expect(podeSobrepor(e, BRUNO, { sala: "s" }, undefined, nova)).toBe(false)
  })

  it("quem tem gerirsalas muda as de cargos abaixo dele, só com o que tem ali", () => {
    const e = estado(comSalas())
    expect(podeSobrepor(e, CARLA, { sala: "s" }, undefined, [{ role: "guia", allow: [], deny: ["mover"] }])).toBe(true)
    expect(podeSobrepor(e, CARLA, { sala: "s" }, undefined, [{ role: CARGO_TODOS, allow: ["mover"], deny: [] }])).toBe(true)
    // Escalation: giving what they don't have.
    expect(podeSobrepor(e, CARLA, { sala: "s" }, undefined, [{ role: CARGO_TODOS, allow: ["fixar"], deny: [] }])).toBe(false)
    // A role ranked above them.
    expect(podeSobrepor(e, CARLA, { sala: "s" }, undefined, [{ role: "chefe", allow: [], deny: ["mover"] }])).toBe(false)
    expect(podeSobrepor(e, CARLA, { sala: "s" }, undefined, [{ role: CARGO_ADMIN, allow: [], deny: [] }])).toBe(false)
  })

  it("as entradas que não mudam não contam: o arrumador mexe na dele sem tocar na do chefe", () => {
    const e = estado(comSalas())
    const doChefe = { role: "chefe", allow: [], deny: ["ligar"] }
    expect(podeSobrepor(e, CARLA, { sala: "s" }, [doChefe], [doChefe, { role: "porteiro", allow: [], deny: ["mover"] }])).toBe(true)
    expect(podeSobrepor(e, CARLA, { sala: "s" }, [doChefe], [])).toBe(false)
  })

  it("e sem gerirsalas NESSA sala, não", () => {
    const e = estado({ ...comSalas(), salas: { s: { perms: [{ role: "arrumador", allow: [], deny: ["gerirsalas"] }] } } })
    expect(podeSobrepor(e, CARLA, { sala: "s" }, undefined, [])).toBe(false)
    expect(podeSobrepor(e, CARLA, { sala: "outra" }, undefined, [])).toBe(true)
  })

  it("guardar: ausente mantém; de quem não pode, mantém; de quem pode, substitui", () => {
    const antes = [{ role: "guia", allow: [], deny: ["mover"] }]
    expect(sobreposicoesAGuardar(antes, undefined, true)).toBe(antes)
    expect(sobreposicoesAGuardar(antes, [], false)).toBe(antes)
    expect(sobreposicoesAGuardar(antes, [], true)).toEqual([])
  })
})

describe("a migração dos cargos e o escritor antigo", () => {
  const novo = { t: "role.define", role: "guia", name: "Guia", powers: ["mover", "gerircargos", "desligar"], rank: 4, removed: false, definedAt: 10 }

  it("um cargo escrito por um cliente antigo, sem nada guardado, fica como veio", () => {
    const velho = { t: "role.define", role: "x", name: "X", powers: ["renomear"], removed: false, definedAt: 1 }
    expect(fundirCargoAntigo(undefined, velho)).toEqual(velho)
  })

  it("a republicação de um cliente antigo (sem rank, sem os poderes novos) não apaga o rank nem os poderes novos", () => {
    const republicado = { t: "role.define", role: "guia", name: "Guia", powers: ["mover"], position: 0, removed: false, definedAt: 10 }
    expect(fundirCargoAntigo(novo, republicado)).toMatchObject({ rank: 4, powers: ["mover", "gerircargos", "desligar"] })
  })

  it("o escritor antigo continua a mandar no que conhece: o nome e os oito antigos", () => {
    const renomeado = { t: "role.define", role: "guia", name: "Guias", powers: ["convidar"], removed: false, definedAt: 11 }
    const fundido = fundirCargoAntigo(novo, renomeado)
    expect(fundido).toMatchObject({ name: "Guias", rank: 4 })
    expect(fundido["powers"]).toEqual(["convidar", "gerircargos", "desligar"])
  })

  it("a lápide de um escritor antigo apaga; um escritor novo diz tudo", () => {
    expect(fundirCargoAntigo(novo, { ...novo, rank: undefined, removed: true })).toMatchObject({ removed: true })
    expect(fundirCargoAntigo(novo, { ...novo, powers: [], rank: 0 })).toMatchObject({ powers: [], rank: 0 })
  })
})

describe("a ordem do canal (compararCargos)", () => {
  const ordem = (lista: { role: string; name: string; rank?: number; position?: number }[]): string[] =>
    [...lista].sort(compararCargos).map((cargo) => cargo.role)

  it("o rank maior vem primeiro: a lista é a hierarquia", () => {
    expect(ordem([
      { role: "porteiro", name: "Porteiro", rank: 1, position: 2 },
      { role: "chefe", name: "Chefe", rank: 3, position: 0 },
      { role: "guia", name: "Guia", rank: 2, position: 1 },
    ])).toEqual(["chefe", "guia", "porteiro"])
  })

  it("sem rank (cargos de antes da 1.2), manda a position e depois o nome, como sempre", () => {
    expect(ordem([
      { role: "b", name: "Beta", position: 1 },
      { role: "z", name: "Zeta", position: 0 },
      { role: "a", name: "Alfa", position: 1 },
    ])).toEqual(["z", "a", "b"])
  })

  it("um cargo novo (rank 0) fica abaixo dos ordenados, mesmo com a position mais baixa", () => {
    expect(ordem([
      { role: "novo", name: "Novo", rank: 0, position: 0 },
      { role: "chefe", name: "Chefe", rank: 2, position: 0 },
      { role: "guia", name: "Guia", rank: 1, position: 1 },
    ])).toEqual(["chefe", "guia", "novo"])
  })
})
