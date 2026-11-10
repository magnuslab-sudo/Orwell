import { describe, expect, it } from "vitest"
import {
  CONTA_PRINCIPAL,
  ContasDoAparelho,
  comContaActiva,
  comContaNova,
  comNome,
  idDeContaNova,
  idDeContaValido,
  lerListaDeContas,
  listaPrecisaDeGravar,
  listaSozinha,
  semConta,
} from "./contasDoAparelho.js"

describe('as contas do aparelho ("Mudar de conta")', () => {
  it("sem lista gravada, o aparelho tem só a conta principal, e essa lista não se grava", () => {
    expect(lerListaDeContas(null)).toEqual({ v: 1, activa: CONTA_PRINCIPAL, contas: [{ id: CONTA_PRINCIPAL, nome: "" }] })
    expect(listaPrecisaDeGravar(listaSozinha())).toBe(false)
    expect(listaPrecisaDeGravar(comNome(listaSozinha(), CONTA_PRINCIPAL, "Ana"))).toBe(false)
  })

  it("acrescentar, mudar, e voltar: a primeira conta fica na lista", () => {
    const nova = idDeContaNova()
    let lista = comContaNova(comNome(listaSozinha(), CONTA_PRINCIPAL, "Ana"), nova)
    expect(lista.activa).toBe(nova)
    expect(lista.contas.map((c) => c.id)).toEqual([CONTA_PRINCIPAL, nova])
    expect(listaPrecisaDeGravar(lista)).toBe(true)
    lista = comNome(lista, nova, "  Bruno  ")
    lista = comContaActiva(lista, CONTA_PRINCIPAL)
    expect(lista).toEqual({ v: 1, activa: CONTA_PRINCIPAL, contas: [{ id: CONTA_PRINCIPAL, nome: "Ana" }, { id: nova, nome: "Bruno" }] })
    // And survives a round trip through disk.
    expect(lerListaDeContas(JSON.stringify(lista))).toEqual(lista)
  })

  it("mudar para uma conta que não está no aparelho atira, com chave de erro", () => {
    expect(() => comContaActiva(listaSozinha(), "outra")).toThrow("there is no such account on this device")
  })

  it("tirar a activa passa a primeira das que ficam; tirar todas volta ao aparelho de sempre", () => {
    const lista = comContaNova(listaSozinha(), "b2")
    expect(semConta(lista, "b2").activa).toBe(CONTA_PRINCIPAL)
    expect(semConta(lista, CONTA_PRINCIPAL)).toEqual({ v: 1, activa: "b2", contas: [{ id: "b2", nome: "" }] })
    expect(listaPrecisaDeGravar(semConta(lista, CONTA_PRINCIPAL))).toBe(true)
    expect(semConta(semConta(lista, "b2"), CONTA_PRINCIPAL)).toEqual(listaSozinha())
  })

  it("um ficheiro estragado, ids que fugiriam da pasta, e uma activa fora da lista", () => {
    expect(lerListaDeContas("{nada")).toEqual(listaSozinha())
    expect(lerListaDeContas(JSON.stringify({ v: 2, activa: "x", contas: [] }))).toEqual(listaSozinha())
    const lida = lerListaDeContas(
      JSON.stringify({ v: 1, activa: "../fora", contas: [{ id: "../fora", nome: "x" }, { id: "boa1", nome: 7 }, { id: "boa1", nome: "dupla" }] }),
    )
    expect(lida).toEqual({ v: 1, activa: "boa1", contas: [{ id: "boa1", nome: "" }] })
  })

  it("os ids novos servem de nome de pasta, e não se repetem", () => {
    const ids = new Set(Array.from({ length: 200 }, () => idDeContaNova()))
    expect(ids.size).toBe(200)
    for (const id of ids) expect(idDeContaValido(id)).toBe(true)
    expect(idDeContaValido("A/B")).toBe(false)
    expect(idDeContaValido("")).toBe(false)
  })
})

describe("ContasDoAparelho, com uma porta de mentira", () => {
  function porta(cofres: Set<string>, memorias = new Set<string>()) {
    const estado = { texto: null as string | null, largadas: [] as string[] }
    return {
      estado,
      porta: {
        lerLista: () => estado.texto,
        gravarLista: (texto: string | null) => {
          estado.texto = texto
        },
        estadoDaConta: async (id: string) => ({ temCofre: cofres.has(id), memorizada: memorias.has(id) }),
        largarConta: async (id: string) => {
          estado.largadas.push(id)
        },
      },
    }
  }

  it("com uma conta só, listar não grava nada: nada muda para quem só tem uma conta", async () => {
    const { estado, porta: p } = porta(new Set([CONTA_PRINCIPAL]), new Set([CONTA_PRINCIPAL]))
    const contas = new ContasDoAparelho(p)
    expect(await contas.listar("Ana")).toEqual([{ id: CONTA_PRINCIPAL, nome: "", activa: true, temCofre: true, memorizada: true }])
    expect(estado.texto).toBeNull()
  })

  it("acrescentar guarda o nome da conta de onde se sai; mudar volta a ela", async () => {
    const cofres = new Set([CONTA_PRINCIPAL])
    const { estado, porta: p } = porta(cofres)
    const contas = new ContasDoAparelho(p)
    const nova = await contas.acrescentar("Ana")
    expect(contas.activa).toBe(nova)
    cofres.add(nova)
    await contas.mudar(CONTA_PRINCIPAL, "Bruno")
    expect(contas.activa).toBe(CONTA_PRINCIPAL)
    expect((await contas.listar()).map((c) => [c.nome, c.activa])).toEqual([
      ["Ana", true],
      ["Bruno", false],
    ])
    expect(estado.largadas).toEqual([])
  })

  it("sair de uma conta acrescentada que nunca teve cofre tira-a da lista", async () => {
    const { estado, porta: p } = porta(new Set([CONTA_PRINCIPAL]))
    const contas = new ContasDoAparelho(p)
    const nova = await contas.acrescentar("Ana")
    await contas.mudar(CONTA_PRINCIPAL)
    expect(estado.largadas).toEqual([nova])
    expect(estado.texto).toBeNull()
    // And adding twice in a row does not leave empty ones behind.
    const a = await contas.acrescentar()
    await contas.acrescentar()
    expect(estado.largadas).toContain(a)
    expect(contas.lista.contas).toHaveLength(2)
  })

  it("apagar a conta activa tira-a da lista e passa à outra", async () => {
    const cofres = new Set([CONTA_PRINCIPAL])
    const { estado, porta: p } = porta(cofres)
    const contas = new ContasDoAparelho(p)
    const nova = await contas.acrescentar("Ana")
    cofres.add(nova)
    await contas.esquecerActiva()
    expect(contas.activa).toBe(CONTA_PRINCIPAL)
    expect(estado.largadas).toEqual([nova])
    expect(estado.texto).toBeNull()
  })

  it("mudar para uma conta que não existe atira e não grava", async () => {
    const { estado, porta: p } = porta(new Set([CONTA_PRINCIPAL]))
    await expect(new ContasDoAparelho(p).mudar("nenhuma")).rejects.toThrow("there is no such account on this device")
    expect(estado.texto).toBeNull()
  })
})
