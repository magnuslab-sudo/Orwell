import { existsSync, readdirSync, readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { entradasDoCanal, origemDoServidorDe, type Session } from "@enclave/client-core"
import { toBase64, type Payload } from "@enclave/protocol"
import {
  ate,
  canalComTodos,
  contasDeTeste,
  desligarContas,
  emparelharAparelho,
  levantarServidor,
  type ContaDeTeste,
  type ServidorDeTeste,
} from "../testes/cliente-de-teste.js"
import type { DenunciaGuardada } from "./denuncia.js"

/**
 * The authenticity proof of each report item (Task 4), end to end: real accounts,
 * messages signed by the author's device, the report assembled from the reporter's
 * vault and sent by the signed request. No network format built by hand.
 */

let servidor: ServidorDeTeste
let ana: ContaDeTeste
let bruno: ContaDeTeste
let carla: ContaDeTeste
let canal: string
const abertas: ContaDeTeste[] = []

beforeAll(async () => {
  servidor = await levantarServidor()
  ;[ana, bruno, carla] = (await contasDeTeste(servidor, ["Ana", "Bruno", "Carla"])) as [ContaDeTeste, ContaDeTeste, ContaDeTeste]
  abertas.push(ana, bruno, carla)
  canal = await canalComTodos(servidor, ana, [bruno, carla])
}, 60_000)

afterAll(async () => {
  desligarContas(abertas)
  await servidor?.fechar()
})

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

/** `author` says `body` on the channel, and expects it to reach `readers`. Returns the id. */
async function dizer(autor: ContaDeTeste, corpo: string, leitores: readonly ContaDeTeste[]): Promise<string> {
  await autor.session.send(canal, mensagem(corpo))
  for (const leitor of leitores) await ate(() => idDe(leitor, corpo) !== undefined, `"${corpo}" chega a ${leitor.nome}`)
  return idDe(leitores[0]!, corpo)!
}

type DenunciaPreparada = Awaited<ReturnType<Session["prepararDenuncia"]>>

const pasta = (): string => join(dirname(servidor.baseDeDados), "denuncias")

function numerosGuardados(): number[] {
  if (!existsSync(pasta())) return []
  return readdirSync(pasta())
    .filter((nome) => /^\d+\.json$/.test(nome))
    .map((nome) => Number(nome.slice(0, -5)))
}

/** Report it and return the report that was stored as a result. */
async function denunciarEGuardada(quem: ContaDeTeste, preparada: DenunciaPreparada): Promise<DenunciaGuardada> {
  const antes = new Set(numerosGuardados())
  const resposta = await quem.session.denunciar(preparada, { motivo: 3, nota: "Insultos.", boaFe: true }, origemDoServidorDe(quem.address), "1.2.0")
  expect(resposta).toEqual({ ok: true })
  const novos = numerosGuardados().filter((numero) => !antes.has(numero))
  expect(novos.length).toBe(1)
  return JSON.parse(readFileSync(join(pasta(), `${novos[0]}.json`), "utf8")) as DenunciaGuardada
}

const aparelhoDe = (conta: ContaDeTeste): string => toBase64(conta.session.identity.deviceSigningPublicKey)

describe("prova de autenticidade da denúncia, com clientes reais", () => {
  it("uma mensagem real do Bruno, denunciada pela Ana, fica 'verificada' com o aparelho do Bruno", async () => {
    const id = await dizer(bruno, "isto é do Bruno, assinado", [ana])
    const preparada = await ana.session.prepararDenuncia({ canal, pessoa: bruno.address, mensagem: { id } })
    const guardada = await denunciarEGuardada(ana, preparada)

    expect(guardada.denunciante).toBe(ana.address)
    expect(guardada.verificacao.geral).toBe("verificada")
    const daDenunciada = guardada.verificacao.itens[preparada.denunciada]!
    expect(daDenunciada).toMatchObject({ indice: preparada.denunciada, autor: bruno.address, veredicto: "verificada" })
    expect(daDenunciada.aparelho).toBe(aparelhoDe(bruno))
    expect(guardada.verificacao.itens.length).toBe(preparada.itens.length)
  }, 60_000)

  it("um corpo alterado e um item movido de canal ficam 'nao-verificada'", async () => {
    const id = await dizer(bruno, "o original que o Bruno disse", [ana])

    const alterada = await ana.session.prepararDenuncia({ canal, pessoa: bruno.address, mensagem: { id } })
    const item = alterada.itens[alterada.denunciada]!.item
    item.p = { ...item.p, body: "o que a Ana queria que ele tivesse dito" }
    const comCorpoAlterado = await denunciarEGuardada(ana, alterada)
    expect(comCorpoAlterado.verificacao.geral).toBe("nao-verificada")
    expect(comCorpoAlterado.verificacao.itens[alterada.denunciada]!.veredicto).toBe("assinatura-invalida")

    const movida = await ana.session.prepararDenuncia({ canal, pessoa: bruno.address, mensagem: { id } })
    movida.canal = `${canal}-outro`
    const movidaDeCanal = await denunciarEGuardada(ana, movida)
    expect(movidaDeCanal.verificacao.geral).toBe("nao-verificada")
    expect(movidaDeCanal.verificacao.itens[movida.denunciada]!.veredicto).toBe("assinatura-invalida")
  }, 60_000)

  it("uma mensagem sem autoria (anterior à S4) fica 'sem-autoria' e a denúncia não é recusada", async () => {
    const corpo = "do Bruno, guardada antes da S4"
    const id = await dizer(bruno, corpo, [carla])
    // Carla's vault stores it the way an app before S4 would have stored it: without authorship.
    const guardadaNoCofre = entradasDoCanal(carla.vault.contents, canal).find((entrada) => entrada.payload["id"] === id)!
    delete (guardadaNoCofre.payload as unknown as Record<string, unknown>)["autoria"]

    const preparada = await carla.session.prepararDenuncia({ canal, pessoa: bruno.address, mensagem: { id } })
    expect(preparada.itens[preparada.denunciada]!.item.p["autoria"]).toBeUndefined()
    const guardada = await denunciarEGuardada(carla, preparada)
    expect(guardada.verificacao.geral).toBe("nao-verificada")
    expect(guardada.verificacao.itens[preparada.denunciada]!.veredicto).toBe("sem-autoria")
    expect(guardada.corpo.itens[preparada.denunciada]!.p["body"]).toBe(corpo)
  }, 60_000)

  it("a cadeia k/x vai na denúncia quando o autor tem folha na árvore", async () => {
    const id = await dizer(bruno, "com a cadeia do Bruno", [carla])
    const preparada = await carla.session.prepararDenuncia({ canal, pessoa: bruno.address, mensagem: { id } })
    const guardada = await denunciarEGuardada(carla, preparada)

    const item = guardada.corpo.itens[preparada.denunciada]!
    const credencial = bruno.session.identity.credential
    expect(item.k).toBe(toBase64(credencial.accountKey))
    expect(item.x).toBe(toBase64(credencial.signature))
    expect(guardada.verificacao.itens[preparada.denunciada]).toMatchObject({ veredicto: "verificada", aparelho: aparelhoDe(bruno) })
    expect(guardada.verificacao.geral).toBe("verificada")
  }, 60_000)

  it("a mensagem real da Carla posta como do Bruno fica 'nao-verificada'", async () => {
    const id = await dizer(carla, "isto é da Carla, não do Bruno", [ana])
    const preparada = await ana.session.prepararDenuncia({ canal, pessoa: carla.address, mensagem: { id } })
    preparada.denunciado = bruno.address
    const guardada = await denunciarEGuardada(ana, preparada)
    // Carla's proof checks out: it is the attribution to Bruno that does not.
    expect(guardada.verificacao.itens[preparada.denunciada]).toMatchObject({ autor: carla.address, veredicto: "verificada" })
    expect(guardada.verificacao.geral).toBe("nao-verificada")
  }, 60_000)

  it("um alvo com outro id ou outra sala que a mensagem assinada fica 'nao-verificada'", async () => {
    const outra = await dizer(bruno, "outra do Bruno", [ana])
    const id = await dizer(bruno, "a do Bruno que se denuncia", [ana])

    const comOutroId = await ana.session.prepararDenuncia({ canal, pessoa: bruno.address, mensagem: { id } })
    comOutroId.alvo = { tipo: "mensagem", id: outra }
    const guardadaComOutroId = await denunciarEGuardada(ana, comOutroId)
    expect(guardadaComOutroId.verificacao.itens[comOutroId.denunciada]!.veredicto).toBe("verificada")
    expect(guardadaComOutroId.verificacao.geral).toBe("nao-verificada")

    // Carla names a room that is not the one Bruno signed.
    await ate(() => idDe(carla, "a do Bruno que se denuncia") !== undefined, "chega à Carla")
    const daCarla = await carla.session.prepararDenuncia({ canal, pessoa: bruno.address, mensagem: { id } })
    daCarla.sala = "outra-sala"
    const guardadaComOutraSala = await denunciarEGuardada(carla, daCarla)
    expect(guardadaComOutraSala.verificacao.itens[daCarla.denunciada]!.veredicto).toBe("verificada")
    expect(guardadaComOutraSala.verificacao.geral).toBe("nao-verificada")
  }, 60_000)

  it("uma chave a mais, fora da assinatura, não fica guardada ao lado da prova", async () => {
    const id = await dizer(carla, "da Carla, com um extra posto pelo Bruno", [bruno])
    const preparada = await bruno.session.prepararDenuncia({ canal, pessoa: carla.address, mensagem: { id } })
    const item = preparada.itens[preparada.denunciada]!.item
    item.p = { ...item.p, acrescento: "texto que a Carla nunca assinou" }
    const guardada = await denunciarEGuardada(bruno, preparada)
    expect(guardada.verificacao.itens[preparada.denunciada]!.veredicto).toBe("verificada")
    expect(guardada.verificacao.geral).toBe("verificada")
    const texto = readFileSync(join(pasta(), `${guardada.numero}.json`), "utf8")
    expect(texto).not.toContain("acrescento")
    expect(texto).not.toContain("texto que a Carla nunca assinou")
    expect(guardada.corpo.itens[preparada.denunciada]!.p["body"]).toBe("da Carla, com um extra posto pelo Bruno")
  }, 60_000)

  it("um aparelho revogado do autor fica 'aparelho-revogado'", async () => {
    const telemovel = await emparelharAparelho(bruno)
    abertas.push(telemovel)
    await ate(() => telemovel.session.channels.includes(canal), "o telemóvel do Bruno entra no canal", 30_000)
    const corpo = "do telemóvel do Bruno, antes de o revogar"
    await telemovel.session.send(canal, mensagem(corpo))
    await ate(() => idDe(carla, corpo) !== undefined, "a mensagem do telemóvel chega à Carla")
    const id = idDe(carla, corpo)!

    // Device revocation through the real path: Bruno's computer removes the phone from the account.
    const doTelemovel = aparelhoDe(telemovel)
    // A channel still settling gives "device-revoke-incomplete" after the manifest
    // goes out; retrying resumes without publishing another one (`revokeDevice`).
    for (let tentativa = 1; ; tentativa++) {
      try {
        await bruno.session.revokeDevice(doTelemovel)
        break
      } catch (erro) {
        if ((erro as Error).message !== "device-revoke-incomplete" || tentativa === 5) throw erro
        await new Promise((resolver) => setTimeout(resolver, 500))
      }
    }
    await ate(() => servidor.enclave.store.isDeviceRevoked(bruno.address, doTelemovel), "o servidor regista a revogação")

    const preparada = await carla.session.prepararDenuncia({ canal, pessoa: bruno.address, mensagem: { id } })
    const guardada = await denunciarEGuardada(carla, preparada)
    expect(guardada.verificacao.itens[preparada.denunciada]).toMatchObject({
      autor: bruno.address,
      veredicto: "aparelho-revogado",
      aparelho: doTelemovel,
    })
    expect(guardada.verificacao.geral).toBe("nao-verificada")
  }, 90_000)
})
