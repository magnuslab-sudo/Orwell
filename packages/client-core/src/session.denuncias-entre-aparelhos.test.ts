import { afterAll, beforeAll, describe, expect, it } from "vitest"
// The harness server, for real, on an ephemeral port, and its accounts and
// pairing. The sessions are from this package: it is the core being measured.
import {
  ate,
  canalComTodos,
  contasDeTeste,
  desligarContas,
  emparelharAparelho,
  levantarServidor,
  type ContaDeTeste,
  type ServidorDeTeste,
} from "../../../apps/server/testes/cliente-de-teste.js"
import { lerCaixa } from "./denuncia.js"
import { origemDoServidorDe } from "./relato.js"
import { Session } from "./session.js"

/**
 * The copy to the founder on all devices of the account (end of reports,
 * 4/11/2026).
 *
 * The copy arrives sealed for the ACCOUNT key, and a paired device does not
 * have it. Until now only the device with the key saw it. Now that device
 * opens it and sends the report already open to its siblings through the
 * account channel (`estado.fichas`, field `denuncias`). The server does not
 * change and learns nothing.
 *
 * The paired device, while the copy waits on the server, knows how many are
 * waiting (`denunciasPorAbrir`), and the interface does not say "No one
 * reported anything".
 */

let servidor: ServidorDeTeste
let ana: ContaDeTeste
let bruno: ContaDeTeste
let carla: ContaDeTeste
let telemovel: ContaDeTeste
let canal: string
const abertas: ContaDeTeste[] = []
const PRIMEIRA = Session.CAIXA_PRIMEIRA_MS

function mensagem(corpo: string): never {
  return { t: "message", id: crypto.randomUUID(), sentAt: Date.now(), body: corpo, attachments: [], links: [], mentions: [] } as never
}

async function dizer(autor: ContaDeTeste, corpo: string, leitores: readonly ContaDeTeste[]): Promise<string> {
  await autor.session.send(canal, mensagem(corpo))
  const idEm = (leitor: ContaDeTeste): string | undefined =>
    leitor.session.history(canal).find((e) => e.payload["body"] === corpo)?.payload["id"] as string | undefined
  for (const leitor of leitores) await ate(() => idEm(leitor) !== undefined, `"${corpo}" chega a ${leitor.nome}`)
  return idEm(leitores[0]!)!
}

async function carlaDenuncia(corpo: string): Promise<void> {
  const id = await dizer(bruno, corpo, [ana, carla])
  await dizer(carla, `a Carla responde a "${corpo}"`, [ana, bruno])
  const origem = origemDoServidorDe(carla.address)
  const preparada = await carla.session.prepararDenuncia({ canal, pessoa: bruno.address, mensagem: { id } }, origem)
  expect(preparada.temCopia).toBe(true)
  await carla.session.denunciar(preparada, { motivo: 3, nota: "Insultos.", boaFe: true }, origem, "1.3.0")
}

async function noCanalDaConta(...aparelhos: ContaDeTeste[]): Promise<void> {
  const daConta = ana.session.canalDaConta
  await ate(() => aparelhos.every((a) => a.vault.contents.groups[daConta] !== undefined), "os aparelhos no canal da conta", 30_000)
}

beforeAll(async () => {
  servidor = await levantarServidor({ denunciaAtrasoHoras: [0, 0] })
  // No reading alone: each test reads the mailbox when it wants.
  Session.CAIXA_PRIMEIRA_MS = 60 * 60_000
  ;[ana, bruno, carla] = (await contasDeTeste(servidor, ["Ana", "Bruno", "Carla"])) as [ContaDeTeste, ContaDeTeste, ContaDeTeste]
  abertas.push(ana, bruno, carla)
  canal = await canalComTodos(servidor, ana, [bruno, carla])
  telemovel = await emparelharAparelho(ana)
  abertas.push(telemovel)
  expect(telemovel.session.temChaveDeConta).toBe(false)
  await noCanalDaConta(ana, telemovel)
}, 120_000)

afterAll(async () => {
  desligarContas(abertas)
  Session.CAIXA_PRIMEIRA_MS = PRIMEIRA
  await servidor?.fechar()
})

describe("a cópia ao fundador em todos os aparelhos da conta", () => {
  it("o emparelhado sabe que há uma à espera, e depois de o principal a abrir vê a mesma denúncia", async () => {
    await carlaDenuncia("o Bruno insulta toda a gente")

    // The phone reads first: it does not open the copy, but knows it is there.
    await telemovel.session.recolherDenuncias()
    expect(telemovel.session.denunciasDe(canal)).toEqual([])
    expect(telemovel.session.denunciasPorAbrir(canal)).toBe(1)
    expect(telemovel.session.denunciasPorAbrir("!outro:orwell.pt")).toBe(0)
    // In the vault: a restart before the next read does not say "no one" again.
    expect(Object.values(telemovel.vault.contents.copiasPorAbrir ?? {})).toEqual([canal])

    const avisos: unknown[] = []
    telemovel.session.on("status", (evento) => {
      if (evento.code === "denuncia-recebida") avisos.push(evento)
    })
    await ana.session.recolherDenuncias()
    const [daAna] = ana.session.denunciasDe(canal)
    expect(daAna).toBeDefined()

    await ate(() => telemovel.session.denunciasDe(canal).length === 1, "a denúncia chega ao telemóvel pela conta", 30_000)
    const [doTelemovel] = telemovel.session.denunciasDe(canal)
    expect(doTelemovel).toEqual(daAna)
    expect(doTelemovel!.itens.filter((item) => item.denunciada).map((item) => item.texto)).toEqual(["o Bruno insulta toda a gente"])
    expect(doTelemovel!.itens.every((item) => item.verificada)).toBe(true)
    // Nothing from who reported, also on the phone side.
    const texto = JSON.stringify(doTelemovel)
    for (const proibido of [carla.address, "a Carla responde", "1.3.0"]) expect(texto).not.toContain(proibido)
    expect(telemovel.session.denunciasPorAbrir(canal)).toBe(0)
    expect(telemovel.vault.contents.copiasPorAbrir).toBeUndefined()
    await ate(() => avisos.length === 1, "o aviso da denúncia no telemóvel")
    expect(avisos[0]).toEqual({ detail: "", code: "denuncia-recebida", channel: canal })

    // The server deletes it as before: the main account marks it as seen in the next request.
    await ana.session.recolherDenuncias()
    expect(await lerCaixa(origemDoServidorDe(ana.address), ana.session.identity, [])).toEqual([])
    // And the phone's next read brings nothing waiting.
    await telemovel.session.recolherDenuncias()
    expect(telemovel.session.denunciasPorAbrir(canal)).toBe(0)
    expect(telemovel.session.denunciasDe(canal).length).toBe(1)
  }, 90_000)

  it("a mesma denúncia que chega duas vezes não entra duas vezes, e a leitura de cada aparelho é dele", async () => {
    const [primeira] = telemovel.session.denunciasDe(canal)
    await telemovel.session.marcarDenunciaLida(primeira!.id)
    await carlaDenuncia("mais um insulto do Bruno")
    await ana.session.recolherDenuncias()
    await ate(() => telemovel.session.denunciasDe(canal).length === 2, "a segunda chega ao telemóvel", 30_000)
    // The first is still read on the phone, and unread on the computer.
    expect(telemovel.session.denunciasDe(canal).find((d) => d.id === primeira!.id)!.lida).toBe(true)
    expect(ana.session.denunciasDe(canal).find((d) => d.id === primeira!.id)!.lida).toBe(false)
  }, 90_000)

  it("um aparelho emparelhado depois recebe as que já tinham chegado", async () => {
    const tablet = await emparelharAparelho(ana, "Ana (tablet)")
    abertas.push(tablet)
    await noCanalDaConta(tablet)
    await ate(() => tablet.session.denunciasDe(canal).length === 2, "as duas chegam ao tablet no estado inteiro", 60_000)
    expect(tablet.session.denunciasDe(canal).map((d) => d.id)).toEqual(ana.session.denunciasDe(canal).map((d) => d.id))
    expect(tablet.session.denunciasDe(canal).every((d) => !d.lida)).toBe(true)
  }, 120_000)
})
