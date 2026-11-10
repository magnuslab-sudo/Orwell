import { existsSync, readdirSync, readFileSync, rmSync } from "node:fs"
import { dirname, join } from "node:path"
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest"
import { lerCaixa, origemDoServidorDe, type Session } from "@enclave/client-core"
import type { ItemDaCaixa, Payload } from "@enclave/protocol"
import {
  ate,
  canalComTodos,
  contasDeTeste,
  desligarContas,
  levantarServidor,
  type ContaDeTeste,
  type ServidorDeTeste,
} from "../testes/cliente-de-teste.js"
import { ArquivoDeDenuncias, CaixaDeEntrega } from "./denuncia.js"

/**
 * The decision to the reporter (Task 9, article 16, section 5 of the DSA),
 * end-to-end with real clients: Ana founds the channel, Bruno writes, Carla
 * reports. Someone closes the report (`fechar`, what the VPS script does), and
 * the decision goes to Carla's inbox with no delay. Only to Carla.
 *
 * The clock: `Date.now` runs ahead by a skew that only grows. We never wait
 * hours or days for real.
 */

const HORA_MS = 3_600_000
const DIA_MS = 24 * HORA_MS
const relogioReal = Date.now.bind(Date)
let desvio = 0
const avancar = (ms: number): void => {
  desvio += ms
}

let servidor: ServidorDeTeste
let ana: ContaDeTeste
let bruno: ContaDeTeste
let carla: ContaDeTeste
let canal: string
const abertas: ContaDeTeste[] = []

type Decidida = { decisao?: string; channel?: string; detail: string }
const decididas = new Map<string, Decidida[]>()

beforeAll(async () => {
  vi.spyOn(Date, "now").mockImplementation(() => relogioReal() + desvio)
  // Copy to the founder with no delay: so Ana has a full inbox, and it shows the
  // decision does not arrive there.
  servidor = await levantarServidor({ denunciaAtrasoHoras: [0, 0] })
  ;[ana, bruno, carla] = (await contasDeTeste(servidor, ["Ana", "Bruno", "Carla"])) as [ContaDeTeste, ContaDeTeste, ContaDeTeste]
  abertas.push(ana, bruno, carla)
  for (const conta of abertas) {
    decididas.set(conta.nome, [])
    conta.session.on("status", (evento) => {
      if (evento.code === "denuncia-decidida") decididas.get(conta.nome)!.push(evento as Decidida)
    })
  }
  canal = await canalComTodos(servidor, ana, [bruno, carla])
}, 90_000)

afterEach(() => {
  // The caps from the previous hour are gone.
  avancar(2 * HORA_MS)
})

afterAll(async () => {
  desligarContas(abertas)
  await servidor?.fechar()
  vi.restoreAllMocks()
})

const dados = (): string => dirname(servidor.baseDeDados)
const pastaDasDenuncias = (): string => join(dados(), "denuncias")
const arquivo = (): ArquivoDeDenuncias => new ArquivoDeDenuncias(pastaDasDenuncias())
const caixa = (): CaixaDeEntrega => new CaixaDeEntrega(join(pastaDasDenuncias(), "caixa"))
const origem = (conta: ContaDeTeste): string => origemDoServidorDe(conta.address)

function mensagem(corpo: string): Payload {
  return {
    t: "message",
    id: crypto.randomUUID(),
    sentAt: Date.now(),
    body: corpo,
    attachments: [],
    links: [],
    mentions: [],
  } as unknown as Payload
}

const idDe = (conta: ContaDeTeste, corpo: string): string | undefined =>
  conta.session.history(canal).find((entrada) => entrada.payload["body"] === corpo)?.payload["id"] as string | undefined

type DenunciaPreparada = Awaited<ReturnType<Session["prepararDenuncia"]>>

/** Bruno writes, Carla reports. Returns the number the server gave. */
async function carlaDenunciaOBruno(corpo: string): Promise<number> {
  await bruno.session.send(canal, mensagem(corpo))
  await ate(() => idDe(carla, corpo) !== undefined, `"${corpo}" chega à Carla`)
  const preparada: DenunciaPreparada = await carla.session.prepararDenuncia(
    { canal, pessoa: bruno.address, mensagem: { id: idDe(carla, corpo)! } },
    origem(carla),
  )
  const antes = new Set((await arquivo().listar()).map((d) => d.numero))
  const escolha = { motivo: 3 as const, nota: "Insultos.", boaFe: true }
  expect(await carla.session.denunciar(preparada, escolha, origem(carla), "1.2.0")).toEqual({ ok: true })
  const nova = (await arquivo().listar()).find((d) => !antes.has(d.numero))
  expect(nova).toBeDefined()
  return nova!.numero
}

/** All files in the inbox of all accounts, in full. */
function ficheirosDaCaixa(): string[] {
  const pasta = join(pastaDasDenuncias(), "caixa")
  if (!existsSync(pasta)) return []
  return readdirSync(pasta, { recursive: true, encoding: "utf8" })
    .filter((nome) => nome.endsWith(".json"))
    .map((nome) => join(pasta, nome))
}

const decisoesNaCaixa = async (conta: ContaDeTeste): Promise<ItemDaCaixa[]> =>
  (await lerCaixa(origem(conta), conta.session.identity, [])).filter((item) => item.tipo === "decisao")

const diaUtc = (ms: number): string => new Date(ms).toISOString().slice(0, 10)

describe("a decisão a quem denunciou, com clientes reais", () => {
  for (const decisao of ["sem-accao", "suspensa"] as const) {
    it(`fechar "${decisao}" deposita a decisão na caixa da Carla, e ela recebe denuncia-decidida só com a decisão`, async () => {
      decididas.get("Carla")!.length = 0
      const numero = await carlaDenunciaOBruno(`o Bruno insulta (${decisao})`)

      // One day passes: the decision carries the day the report arrived.
      avancar(DIA_MS)
      const agora = Date.now()
      const fechada = await arquivo().fechar(numero, decisao, caixa(), agora)
      expect(fechada).toMatchObject({ numero, estado: "fechada", decisao })
      expect(Date.parse(fechada.fechada!)).toBe(agora)
      expect(await arquivo().ler(numero)).toMatchObject({ estado: "fechada", decisao })

      // No delay: it is in the inbox already.
      await carla.session.recolherDenuncias()
      expect(decididas.get("Carla")).toEqual([{ detail: "", code: "denuncia-decidida", decisao }])
      const evento = JSON.stringify(decididas.get("Carla"))
      for (const proibido of [String(numero), `d-${numero}`, bruno.address, canal, "Insultos", "insulta"]) {
        expect(evento).not.toContain(proibido)
      }

      // In the vault, once per id, and the id given by seen in the same write. The
      // `day` is that of `received` (the route saves it with `new Date()`, the real
      // clock), not the closure day, one day later.
      const dia = fechada.recebida.slice(0, 10)
      expect(dia).not.toBe(diaUtc(agora))
      const feitas = carla.vault.contents.denunciasFeitas ?? []
      expect(feitas.filter((f) => f.numeroLocal === `d-${numero}`)).toEqual([
        { numeroLocal: `d-${numero}`, canal, dia, decisao },
      ])
      expect(carla.vault.contents.caixaVista ?? []).toContain(`d-${numero}`)

      // The next read tells the server it has been saved: the server deletes it and never returns it.
      await carla.session.recolherDenuncias()
      expect(decididas.get("Carla")!.length).toBe(1)
      expect(await decisoesNaCaixa(carla)).toEqual([])
      expect((carla.vault.contents.denunciasFeitas ?? []).filter((f) => f.numeroLocal === `d-${numero}`).length).toBe(1)
    }, 90_000)
  }

  it("a decisão não chega ao fundador nem ao denunciado", async () => {
    const numero = await carlaDenunciaOBruno("o Bruno outra vez")
    await arquivo().fechar(numero, "suspensa", caixa())

    // Only one decision file, and it is Carla's.
    const comDecisao = ficheirosDaCaixa()
      .map((ficheiro) => JSON.parse(readFileSync(ficheiro, "utf8")) as { endereco: string; item: ItemDaCaixa })
      .filter((guardado) => guardado.item.tipo === "decisao" && guardado.item.id === `d-${numero}`)
    expect(comDecisao.map((guardado) => guardado.endereco)).toEqual([carla.address])

    for (const conta of [ana, bruno]) {
      expect(await decisoesNaCaixa(conta)).toEqual([])
      await conta.session.recolherDenuncias()
      expect(conta.vault.contents.denunciasFeitas).toBeUndefined()
      expect(decididas.get(conta.nome)).toEqual([])
    }
    // Ana, the founder, received the copy, and only the copy.
    expect(Object.values(ana.vault.contents.denuncias ?? {}).flat().length).toBeGreaterThan(0)
    // And Carla receives it.
    await carla.session.recolherDenuncias()
    expect(decididas.get("Carla")!.at(-1)).toEqual({ detail: "", code: "denuncia-decidida", decisao: "suspensa" })
  }, 90_000)

  it("fechar uma denúncia que não existe, ou já fechada, recusa e não deposita nada", async () => {
    await expect(arquivo().fechar(99_999, "sem-accao", caixa())).rejects.toThrow()
    const numero = await carlaDenunciaOBruno("o Bruno ainda")
    await arquivo().fechar(numero, "sem-accao", caixa())
    rmSync(join(pastaDasDenuncias(), "caixa"), { recursive: true, force: true })
    await expect(arquivo().fechar(numero, "suspensa", caixa())).rejects.toThrow()
    expect(ficheirosDaCaixa()).toEqual([])
    expect(await arquivo().ler(numero)).toMatchObject({ decisao: "sem-accao" })
  }, 90_000)

  it("a mesma decisão depositada outra vez, depois de dada por vista, não faz segundo aviso nem segunda entrada", async () => {
    decididas.get("Carla")!.length = 0
    const numero = await carlaDenunciaOBruno("o Bruno repete")
    const fechada = await arquivo().fechar(numero, "sem-accao", caixa())
    await carla.session.recolherDenuncias()
    await carla.session.recolherDenuncias()
    expect(await decisoesNaCaixa(carla)).toEqual([])
    expect(decididas.get("Carla")!.length).toBe(1)

    // The script runs again after a failure: the same item goes back to the inbox.
    const item: ItemDaCaixa = {
      tipo: "decisao",
      id: `d-${numero}`,
      denuncia: numero,
      decisao: "sem-accao",
      canal,
      dia: fechada.recebida.slice(0, 10),
    }
    await caixa().depositar(carla.address, item, Date.now())
    expect((await decisoesNaCaixa(carla)).map((i) => i.id)).toEqual([`d-${numero}`])

    await carla.session.recolherDenuncias()
    expect(decididas.get("Carla")!.length).toBe(1)
    expect((carla.vault.contents.denunciasFeitas ?? []).filter((f) => f.numeroLocal === `d-${numero}`).length).toBe(1)
    expect(carla.vault.contents.caixaVista ?? []).toContain(`d-${numero}`)
    // Mark as read: the next read deletes it on the server and never returns it.
    await carla.session.recolherDenuncias()
    expect(await decisoesNaCaixa(carla)).toEqual([])
    expect(decididas.get("Carla")!.length).toBe(1)
  }, 90_000)

  it("depois de uma falha a meio, fechar com outra decisão recusa e não mexe em nada; com a mesma, fecha", async () => {
    const numero = await carlaDenunciaOBruno("o Bruno a meio")
    const aberta = (await arquivo().ler(numero))!
    // The inbox already has the decision, and the report file was left open.
    const item: ItemDaCaixa = {
      tipo: "decisao",
      id: `d-${numero}`,
      denuncia: numero,
      decisao: "suspensa",
      canal,
      dia: aberta.recebida.slice(0, 10),
    }
    await caixa().depositar(carla.address, item, Date.now())
    const ficheiroDaDecisao = ficheirosDaCaixa().find((f) => f.endsWith(`d-${numero}.json`))!
    const antesNaCaixa = readFileSync(ficheiroDaDecisao, "utf8")
    const ficheiroDaDenuncia = join(pastaDasDenuncias(), `${numero}.json`)
    const antesNaDenuncia = readFileSync(ficheiroDaDenuncia, "utf8")

    await expect(arquivo().fechar(numero, "sem-accao", caixa())).rejects.toThrow(/já tem a decisão "suspensa"/)
    expect(readFileSync(ficheiroDaDecisao, "utf8")).toBe(antesNaCaixa)
    expect(readFileSync(ficheiroDaDenuncia, "utf8")).toBe(antesNaDenuncia)

    expect(await arquivo().fechar(numero, "suspensa", caixa())).toMatchObject({ estado: "fechada", decisao: "suspensa" })
    expect((await decisoesNaCaixa(carla)).filter((i) => i.id === `d-${numero}`)).toEqual([item])
  }, 90_000)
})
