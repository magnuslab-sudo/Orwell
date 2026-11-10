import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs"
import { dirname, join } from "node:path"
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest"
import {
  conteudoDaCopia,
  corpoDaDenuncia,
  enviarDenuncia,
  lerCaixa,
  origemDoServidorDe,
  pedirFundador,
  selarCopia,
  type Session,
} from "@enclave/client-core"
import { abrirComConta } from "@enclave/crypto"
import { ConteudoDaCopia, fromBase64, moradaDeSala, toBase64, type ItemDaCaixa, type Payload } from "@enclave/protocol"
import {
  ate,
  canalComTodos,
  contasDeTeste,
  desligarContas,
  levantarServidor,
  type ContaDeTeste,
  type ServidorDeTeste,
} from "../testes/cliente-de-teste.js"
import { tmpdir } from "node:os"
import { atrasoAleatorioMs, CaixaDeEntrega, DENUNCIA_MAX_BYTES, type DenunciaGuardada } from "./denuncia.js"

/**
 * The sealed copy to the founder (Task 5), end-to-end with real clients: Ana
 * founds the channel, Bruno writes, Carla reports. Dora is not in the channel.
 * The server decides who the founder is, and the copy waits in their inbox for
 * 1 to 6 hours.
 *
 * The clock: `Date.now` runs ahead by a skew that only grows. The signer and
 * the verifier live in the same process and see the same clock; the wait times
 * (`setTimeout`) stay real. We never wait hours for real.
 */

const HORA_MS = 3_600_000
const relogioReal = Date.now.bind(Date)
let desvio = 0
const avancar = (ms: number): void => {
  desvio += ms
}

let servidor: ServidorDeTeste
let ana: ContaDeTeste
let bruno: ContaDeTeste
let carla: ContaDeTeste
let dora: ContaDeTeste
let canal: string
const abertas: ContaDeTeste[] = []

beforeAll(async () => {
  vi.spyOn(Date, "now").mockImplementation(() => relogioReal() + desvio)
  servidor = await levantarServidor({ denunciaAtrasoHoras: [1, 6] })
  ;[ana, bruno, carla, dora] = (await contasDeTeste(servidor, ["Ana", "Bruno", "Carla", "Dora"])) as [
    ContaDeTeste,
    ContaDeTeste,
    ContaDeTeste,
    ContaDeTeste,
  ]
  abertas.push(ana, bruno, carla, dora)
  canal = await canalComTodos(servidor, ana, [bruno, carla])
}, 90_000)

afterEach(() => {
  // Each test starts with empty boxes and caps from the previous hour already removed.
  rmSync(pastaDaCaixa(), { recursive: true, force: true })
  avancar(2 * HORA_MS)
})

afterAll(async () => {
  desligarContas(abertas)
  await servidor?.fechar()
  vi.restoreAllMocks()
})

function mensagem(corpo: string, extra: Record<string, unknown> = {}): Payload {
  return {
    t: "message",
    id: crypto.randomUUID(),
    sentAt: Date.now(),
    body: corpo,
    attachments: [],
    links: [],
    mentions: [],
    ...extra,
  } as unknown as Payload
}

const idDe = (conta: ContaDeTeste, onde: string, corpo: string): string | undefined =>
  conta.session.history(onde).find((entrada) => entrada.payload["body"] === corpo)?.payload["id"] as string | undefined

async function dizer(
  autor: ContaDeTeste,
  onde: string,
  corpo: string,
  leitores: readonly ContaDeTeste[],
  extra: Record<string, unknown> = {},
): Promise<string> {
  await autor.session.send(onde, mensagem(corpo, extra))
  for (const leitor of leitores) await ate(() => idDe(leitor, onde, corpo) !== undefined, `"${corpo}" chega a ${leitor.nome}`)
  return idDe(leitores[0]!, onde, corpo)!
}

type DenunciaPreparada = Awaited<ReturnType<Session["prepararDenuncia"]>>

const dados = (): string => dirname(servidor.baseDeDados)
const pastaDaCaixa = (): string => join(dados(), "denuncias", "caixa")
const origem = (conta: ContaDeTeste): string => origemDoServidorDe(conta.address)

/** All files in the inbox, from all accounts. */
function ficheirosDaCaixa(): string[] {
  if (!existsSync(pastaDaCaixa())) return []
  return readdirSync(pastaDaCaixa(), { recursive: true, encoding: "utf8" })
    .filter((nome) => nome.endsWith(".json"))
    .map((nome) => join(pastaDaCaixa(), nome))
}

const ESCOLHA = { motivo: 3 as const, nota: "Insultos.", boaFe: true, contacto: { nome: "Carla Silva", email: "carla@exemplo.pt" } }

async function denunciar(quem: ContaDeTeste, preparada: DenunciaPreparada): Promise<void> {
  expect(await quem.session.denunciar(preparada, ESCOLHA, origem(quem), "1.2.0")).toEqual({ ok: true })
}

const caixaDe = (conta: ContaDeTeste, vistos: readonly string[] = []): Promise<ItemDaCaixa[]> =>
  lerCaixa(origem(conta), conta.session.identity, vistos)

const chaveDeContaDe = (conta: ContaDeTeste): Uint8Array => conta.session.identity.credential.accountKey

function diaUtc(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10)
}

describe("cópia selada ao fundador, com clientes reais", () => {
  it("a cópia aberta pelo fundador não tem mensagens, autoria, versão, aparelho nem hora de quem denuncia", async () => {
    const id = await dizer(bruno, canal, "o Bruno insulta toda a gente", [ana, carla])
    await dizer(carla, canal, "a Carla responde ao Bruno", [ana, bruno])
    const preparada = await carla.session.prepararDenuncia({ canal, pessoa: bruno.address, mensagem: { id } }, origem(carla))
    expect(preparada.temCopia).toBe(true)
    // Our copy carries Carla's message; the founder's does not.
    expect(preparada.itens.some((item) => item.autor === carla.address)).toBe(true)

    const quando = Date.now()
    await denunciar(carla, preparada)
    expect(ficheirosDaCaixa().length).toBe(1)
    // Not yet: the copy waits at least 1 hour.
    expect(await ana.session.lerCaixaDeDenuncias()).toEqual([])

    avancar(6 * HORA_MS + 60_000)
    const recebidos = await ana.session.lerCaixaDeDenuncias()
    expect(recebidos.length).toBe(1)
    const recebido = recebidos[0]!
    if (recebido.tipo !== "copia") throw new Error("esperava uma cópia")
    expect(recebido.canal).toBe(canal)

    // Opens only with Ana's account private key.
    const selo = { e: fromBase64(recebido.copia.e), n: fromBase64(recebido.copia.n), c: fromBase64(recebido.copia.c) }
    expect(abrirComConta(carla.session.identity.signingPrivateKey!, canal, selo)).toBeNull()
    const aberto = abrirComConta(ana.session.identity.signingPrivateKey!, canal, selo)
    expect(aberto).not.toBeNull()
    const conteudo = ConteudoDaCopia.parse(JSON.parse(new TextDecoder().decode(aberto!)))
    expect(recebido.conteudo).toEqual(conteudo)

    expect(Object.keys(conteudo).sort()).toEqual(
      ["alvo", "canal", "denunciada", "denunciado", "dia", "itens", "motivo", "nota", "v"].sort(),
    )
    expect(conteudo).toMatchObject({ motivo: 3, nota: "Insultos.", canal, denunciado: bruno.address, alvo: { tipo: "mensagem", id } })
    expect(conteudo.dia).toBe(diaUtc(quando))
    expect(conteudo.itens.length).toBeGreaterThan(0)
    expect(conteudo.itens.every((item) => item.a !== carla.address)).toBe(true)
    expect(conteudo.itens[conteudo.denunciada]!.p["id"]).toBe(id)
    // The server sequence comes from the copy: the jumps showed where Carla's messages were.
    expect(preparada.itensDoFundador.some((item) => item.item.s >= 0)).toBe(true)
    expect(conteudo.itens.every((item) => item.s === -1)).toBe(true)

    const texto = JSON.stringify(conteudo)
    for (const proibido of [
      carla.address,
      toBase64(carla.session.identity.deviceSigningPublicKey),
      toBase64(chaveDeContaDe(carla)),
      "a Carla responde",
      "1.2.0",
      "versao",
      "aparelho",
      "Carla Silva",
      "carla@exemplo.pt",
      "boaFe",
      "contacto",
    ]) {
      expect(texto).not.toContain(proibido)
    }
    // From the time of the report, nothing: no ISO with time, no milliseconds.
    expect(texto).not.toMatch(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/)
    expect(JSON.stringify(recebidos)).not.toContain(carla.address)
    for (const ficheiro of ficheirosDaCaixa()) expect(readFileSync(ficheiro, "utf8")).not.toContain(carla.address)
  }, 90_000)

  it("antes de 1 h a caixa do fundador vem vazia; entre 1 e 6 h chega", async () => {
    const id = await dizer(bruno, canal, "outra do Bruno", [carla])
    const preparada = await carla.session.prepararDenuncia({ canal, pessoa: bruno.address, mensagem: { id } }, origem(carla))
    const antes = Date.now()
    await denunciar(carla, preparada)
    const depois = Date.now()

    const [ficheiro] = ficheirosDaCaixa()
    expect(ficheiro).toBeDefined()
    const { entregarEm } = JSON.parse(readFileSync(ficheiro!, "utf8")) as { entregarEm: number }
    expect(entregarEm).toBeGreaterThanOrEqual(antes + HORA_MS)
    expect(entregarEm).toBeLessThanOrEqual(depois + 6 * HORA_MS)

    avancar(HORA_MS - 60_000)
    expect(await caixaDe(ana)).toEqual([])
    avancar(entregarEm - Date.now() + 1)
    const chegou = await caixaDe(ana)
    expect(chegou.length).toBe(1)
    expect(chegou[0]!.tipo).toBe("copia")
  }, 90_000)

  it("quem não é fundador nunca recebe cópia; numa conversa directa não há cópia", async () => {
    const id = await dizer(bruno, canal, "mais uma do Bruno", [carla])
    await denunciar(carla, await carla.session.prepararDenuncia({ canal, pessoa: bruno.address, mensagem: { id } }, origem(carla)))
    avancar(6 * HORA_MS + 60_000)
    for (const conta of [bruno, carla, dora]) expect(await caixaDe(conta)).toEqual([])
    expect((await caixaDe(ana)).length).toBe(1)
    rmSync(pastaDaCaixa(), { recursive: true, force: true })

    // The direct one: Bruno opens it, and the address claim is his.
    const directa = await bruno.session.openDirect(carla.address)
    await ate(() => carla.session.channels.includes(directa), "a directa chega à Carla")
    const naDirecta = await dizer(bruno, directa, "o Bruno na directa", [carla])
    const daDirecta = await carla.session.prepararDenuncia(
      { canal: directa, pessoa: bruno.address, mensagem: { id: naDirecta } },
      origem(carla),
    )
    expect(daDirecta.temCopia).toBe(false)
    await denunciar(carla, daDirecta)
    avancar(6 * HORA_MS + 60_000)
    expect(ficheirosDaCaixa()).toEqual([])
    for (const conta of [ana, bruno, carla]) expect(await caixaDe(conta)).toEqual([])
  }, 90_000)

  it("se o fundador é o denunciado, não há cópia; se não está no canal, não há cópia", async () => {
    // Ana is the founder and the reported.
    const daAna = await dizer(ana, canal, "a Ana também insulta", [carla])
    const contraAFundadora = await carla.session.prepararDenuncia({ canal, pessoa: ana.address, mensagem: { id: daAna } }, origem(carla))
    expect(contraAFundadora.temCopia).toBe(false)
    await denunciar(carla, contraAFundadora)
    // Even if the device of the reporter sends the copy, the server throws it away.
    await enviarDenuncia(
      origem(carla),
      carla.session.identity,
      corpoDaDenuncia(contraAFundadora, ESCOLHA, "1.2.0", {
        fundador: ana.address,
        copia: selarCopia(chaveDeContaDe(ana), conteudoDaCopia(contraAFundadora, ESCOLHA, Date.now())),
      }),
    )
    expect(ficheirosDaCaixa()).toEqual([])

    // Another channel, which Ana leaves after founding.
    const outro = await canalComTodos(servidor, ana, [bruno, carla])
    const doBruno = await dizer(bruno, outro, "o Bruno no outro canal", [carla])
    await ana.session.leaveChannel(outro)
    await ate(() => !servidor.enclave.store.isSubscribed(outro, ana.address), "a Ana sai do outro canal")
    expect(servidor.enclave.store.claimantOf(outro)).toBe(ana.address)
    const semFundador = await carla.session.prepararDenuncia({ canal: outro, pessoa: bruno.address, mensagem: { id: doBruno } }, origem(carla))
    expect(semFundador.temCopia).toBe(false)
    await denunciar(carla, semFundador)
    await enviarDenuncia(
      origem(carla),
      carla.session.identity,
      corpoDaDenuncia(semFundador, ESCOLHA, "1.2.0", {
        fundador: ana.address,
        copia: selarCopia(chaveDeContaDe(ana), conteudoDaCopia(semFundador, ESCOLHA, Date.now())),
      }),
    )
    avancar(6 * HORA_MS + 60_000)
    expect(ficheirosDaCaixa()).toEqual([])
    expect(await caixaDe(ana)).toEqual([])
  }, 120_000)

  it("o fundador vem do servidor: uma denúncia com `fundador` diferente do claim deposita nada", async () => {
    const id = await dizer(bruno, canal, "o Bruno outra vez", [carla])
    const preparada = await carla.session.prepararDenuncia({ canal, pessoa: bruno.address, mensagem: { id } }, origem(carla))
    const antes = readdirSync(join(dados(), "denuncias")).filter((nome) => /^\d+\.json$/.test(nome)).length
    // Carla says the founder is Dora, and seals for her.
    await enviarDenuncia(
      origem(carla),
      carla.session.identity,
      corpoDaDenuncia(preparada, ESCOLHA, "1.2.0", {
        fundador: dora.address,
        copia: selarCopia(chaveDeContaDe(dora), conteudoDaCopia(preparada, ESCOLHA, Date.now())),
      }),
    )
    // No founder, the copy is there all the same.
    await enviarDenuncia(
      origem(carla),
      carla.session.identity,
      corpoDaDenuncia(preparada, ESCOLHA, "1.2.0", {
        fundador: null,
        copia: selarCopia(chaveDeContaDe(ana), conteudoDaCopia(preparada, ESCOLHA, Date.now())),
      }),
    )
    // Both reports were saved; no copy.
    const depois = readdirSync(join(dados(), "denuncias")).filter((nome) => /^\d+\.json$/.test(nome)).length
    expect(depois - antes).toBe(2)
    avancar(6 * HORA_MS + 60_000)
    expect(ficheirosDaCaixa()).toEqual([])
    expect(await caixaDe(dora)).toEqual([])
    expect(await caixaDe(ana)).toEqual([])
  }, 90_000)

  it("/_enclave/denuncia/fundador a quem não está no canal responde fundador null, igual a canal sem fundador", async () => {
    const deFora = await pedirFundador(origem(dora), dora.session.identity, canal)
    const semDono = await pedirFundador(origem(carla), carla.session.identity, moradaDeSala(servidor.casa))
    expect(deFora).toEqual({ fundador: null, chaveDeConta: null })
    expect(semDono).toEqual(deFora)
    expect(await pedirFundador(origem(carla), carla.session.identity, canal)).toEqual({
      fundador: ana.address,
      chaveDeConta: toBase64(chaveDeContaDe(ana)),
    })
  }, 60_000)

  it("a cópia levantada e vista é apagada; a não vista volta a vir", async () => {
    const um = await dizer(bruno, canal, "a primeira de duas", [carla])
    const dois = await dizer(bruno, canal, "a segunda de duas", [carla])
    await denunciar(carla, await carla.session.prepararDenuncia({ canal, pessoa: bruno.address, mensagem: { id: um } }, origem(carla)))
    await denunciar(carla, await carla.session.prepararDenuncia({ canal, pessoa: bruno.address, mensagem: { id: dois } }, origem(carla)))
    avancar(6 * HORA_MS + 60_000)

    const primeira = await caixaDe(ana)
    expect(primeira.length).toBe(2)
    const [vista, naoVista] = primeira as [ItemDaCaixa, ItemDaCaixa]
    const segunda = await caixaDe(ana, [vista.id])
    expect(segunda.map((item) => item.id)).toEqual([naoVista.id])
    expect(ficheirosDaCaixa().length).toBe(1)
    expect((await caixaDe(ana)).map((item) => item.id)).toEqual([naoVista.id])
    // A seen mark from another account does not clear anything from Ana's inbox.
    await caixaDe(carla, [naoVista.id])
    expect(ficheirosDaCaixa().length).toBe(1)
  }, 90_000)
})

describe("a sala comum, uma chave má e uma resposta que não se lê", () => {
  it("a sala comum nunca dá cópia: quem a reclamou primeiro não é fundador de um espaço", async () => {
    const comum = servidor.sala
    for (const conta of [ana, bruno, carla]) {
      await conta.session.ensureCommonRoom()
      await ate(() => conta.session.channels.includes(comum), `${conta.nome} está na sala comum`, 30_000)
    }
    const dono = servidor.enclave.store.claimantOf(comum)
    expect(dono).toBeDefined()
    expect(servidor.enclave.store.isSubscribed(comum, dono!)).toBe(true)
    const doDono = [ana, bruno, carla].find((conta) => conta.address === dono)!
    const autor = [ana, bruno, carla].find((conta) => conta !== doDono)!
    const quemDenuncia = [ana, bruno, carla].find((conta) => conta !== doDono && conta !== autor)!

    expect(await pedirFundador(origem(quemDenuncia), quemDenuncia.session.identity, comum)).toEqual({ fundador: null, chaveDeConta: null })
    const id = await dizer(autor, comum, "uma frase na sala comum", [quemDenuncia])
    const preparada = await quemDenuncia.session.prepararDenuncia({ canal: comum, pessoa: autor.address, mensagem: { id } }, origem(quemDenuncia))
    expect(preparada.temCopia).toBe(false)
    await denunciar(quemDenuncia, preparada)
    // Even with forced replication to whoever claimed the room.
    await enviarDenuncia(
      origem(quemDenuncia),
      quemDenuncia.session.identity,
      corpoDaDenuncia(preparada, ESCOLHA, "1.2.0", {
        fundador: dono!,
        copia: selarCopia(chaveDeContaDe(doDono), conteudoDaCopia(preparada, ESCOLHA, Date.now())),
      }),
    )
    avancar(6 * HORA_MS + 60_000)
    expect(ficheirosDaCaixa()).toEqual([])
    expect(await caixaDe(doDono)).toEqual([])
  }, 120_000)

  it("uma chaveDeConta má na resposta do servidor deixa passar a denúncia, sem cópia", async () => {
    const id = await dizer(bruno, canal, "o Bruno antes da chave má", [carla])
    const buscarReal = globalThis.fetch
    const espia = vi.spyOn(globalThis, "fetch").mockImplementation(async (entrada, init) => {
      const resposta = await buscarReal(entrada, init)
      if (!String(entrada).endsWith("/_enclave/denuncia/fundador")) return resposta
      // A low-order point (the Ed25519 identity) in place of Ana's key.
      const baixa = new Uint8Array(32)
      baixa[0] = 1
      return new Response(JSON.stringify({ fundador: ana.address, chaveDeConta: toBase64(baixa) }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })
    })
    try {
      const preparada = await carla.session.prepararDenuncia({ canal, pessoa: bruno.address, mensagem: { id } }, origem(carla))
      expect(preparada.temCopia).toBe(false)
      const nomes = (): string[] => readdirSync(join(dados(), "denuncias")).filter((nome) => /^\d+\.json$/.test(nome))
      const antes = nomes().length
      await denunciar(carla, preparada)
      expect(nomes().length).toBe(antes + 1)
    } finally {
      espia.mockRestore()
    }
    avancar(6 * HORA_MS + 60_000)
    expect(ficheirosDaCaixa()).toEqual([])
  }, 90_000)

  it("uma resposta que não se lê dá \"could not read the report inbox\"", async () => {
    const torta: typeof fetch = async () =>
      new Response(JSON.stringify({ fundador: 12, itens: "não" }), { status: 200, headers: { "content-type": "application/json" } })
    await expect(pedirFundador(origem(carla), carla.session.identity, canal, torta)).rejects.toThrow("could not read the report inbox")
    await expect(lerCaixa(origem(carla), carla.session.identity, [], torta)).rejects.toThrow("could not read the report inbox")
  })
})

describe("o servidor tira os bytes e os segredos dos anexos de cada item guardado", () => {
  it("quem põe bytes inline num item não os encontra no ficheiro guardado", async () => {
    const anexo = { name: "foto.png", mediaType: "image/png", byteLength: 4, kind: "image", inline: "data:image/png;base64,iVBORw0K" }
    const id = await dizer(bruno, canal, "o Bruno com uma imagem", [carla], { attachments: [anexo] })
    const preparada = await carla.session.prepararDenuncia({ canal, pessoa: bruno.address, mensagem: { id } }, origem(carla))
    const item = preparada.itens[preparada.denunciada]!.item
    const BYTES = "QUJDREVGR0hJSktMTU5PUFFSU1RVVldYWVo"
    // Carla puts bytes and secrets back into the attachment, and in an item that the schema rejects.
    item.p = {
      ...item.p,
      attachments: [
        {
          name: "foto.png",
          mediaType: "image/png",
          byteLength: 4,
          evicted: true,
          inline: `data:image/png;base64,${BYTES}`,
          url: "https://exemplo.pt/blob",
          key: "chave-secreta",
          nonce: "nonce-secreto",
          digest: "resumo-secreto",
          poster: `data:image/jpeg;base64,${BYTES}`,
          partes: [{ sha: "x" }],
          blurhash: "LEHV6nWB2yk8",
        },
      ],
    }
    const torto = {
      s: -1,
      a: bruno.address,
      p: {
        t: "message",
        id: "torto",
        body: 12345,
        attachments: [{ name: "b.bin", mediaType: "x/y", inline: BYTES, key: "chave-secreta" }],
        links: [{ url: "https://exemplo.pt", thumbnail: `data:image/png;base64,${BYTES}` }],
      },
    }
    preparada.itens.push({ ...preparada.itens[preparada.denunciada]!, item: torto, denunciada: false })

    const nomes = (): string[] => readdirSync(join(dados(), "denuncias")).filter((nome) => /^\d+\.json$/.test(nome))
    const antes = new Set(nomes())
    await denunciar(carla, preparada)
    const novo = nomes().find((nome) => !antes.has(nome))!
    const texto = readFileSync(join(dados(), "denuncias", novo), "utf8")
    for (const proibido of [BYTES, "iVBORw0K", "chave-secreta", "nonce-secreto", "resumo-secreto", "exemplo.pt/blob", "LEHV6nWB2yk8", '"inline"', '"poster"', '"partes"', '"thumbnail"']) {
      expect(texto).not.toContain(proibido)
    }
    const guardada = JSON.parse(texto) as DenunciaGuardada
    expect(guardada.corpo.itens[preparada.denunciada]!.p["attachments"]).toEqual([
      { name: "foto.png", mediaType: "image/png", byteLength: 4, evicted: true },
    ])
    expect(guardada.corpo.itens.at(-1)!.p["attachments"]).toEqual([{ name: "b.bin", mediaType: "x/y" }])
    // The proof does not change for this reason: the signed form only reads the name and the type.
    expect(guardada.verificacao.itens[preparada.denunciada]!.veredicto).toBe("verificada")
  }, 90_000)
})

describe("o corpo no tecto, com a cópia no tecto, chega à rota", () => {
  it("uma denúncia de quase 512 KiB com uma cópia de 600 000 caracteres é aceite, e a cópia sem fundador cai", async () => {
    const id = await dizer(bruno, canal, "o Bruno antes de um corpo grande", [carla])
    const preparada = await carla.session.prepararDenuncia({ canal, pessoa: bruno.address, mensagem: { id } }, origem(carla))
    const grande = { s: -1, a: bruno.address, p: { t: "message", id: "grande", body: "x".repeat(DENUNCIA_MAX_BYTES - 40_000) } }
    preparada.itens.push({ ...preparada.itens[preparada.denunciada]!, item: grande, denunciada: false })
    const copia = { v: 1 as const, e: "A".repeat(43), n: "A".repeat(32), c: "A".repeat(600_000) }
    const corpo = corpoDaDenuncia(preparada, ESCOLHA, "1.2.0", { fundador: null, copia })
    expect(Buffer.byteLength(JSON.stringify(corpo))).toBeGreaterThan(1024 * 1024)
    expect(await enviarDenuncia(origem(carla), carla.session.identity, corpo)).toEqual({ ok: true })
    expect(ficheirosDaCaixa()).toEqual([])
  }, 90_000)
})

describe("a caixa e o atraso, sem rede", () => {
  it("o atraso fica entre 1 e 6 h, com os dois extremos", () => {
    expect(atrasoAleatorioMs([1, 6], () => 0)).toBe(HORA_MS)
    expect(atrasoAleatorioMs([1, 6], () => 0.999_999_999_9)).toBe(6 * HORA_MS)
    for (let i = 0; i < 200; i++) {
      const atraso = atrasoAleatorioMs([1, 6])
      expect(atraso).toBeGreaterThanOrEqual(HORA_MS)
      expect(atraso).toBeLessThanOrEqual(6 * HORA_MS)
    }
  })

  it("só entrega à conta certa, ignora vistos mal formados, e o varrimento apaga o esquecido", async () => {
    const pasta = mkdtempSync(join(tmpdir(), "enclave-caixa-"))
    const caixa = new CaixaDeEntrega(pasta)
    const copia = { v: 1 as const, e: "A".repeat(43), n: "A".repeat(32), c: "AAAA" }
    // Two addresses with the same short address (the first 32 characters).
    const um = `@${"a".repeat(32)}um:localhost`
    const outro = `@${"a".repeat(32)}outro:localhost`
    await caixa.depositar(um, { tipo: "copia", id: "c1", canal: "x", copia }, 1_000)
    await caixa.depositar(outro, { tipo: "copia", id: "c2", canal: "x", copia }, 1_000)
    expect((await caixa.levantar(um, [], 999)).length).toBe(0)
    expect((await caixa.levantar(um, ["../c2", "c2"], 1_000)).map((item) => item.id)).toEqual(["c1"])
    expect((await caixa.levantar(outro, [], 1_000)).map((item) => item.id)).toEqual(["c2"])
    await expect(caixa.depositar(um, { tipo: "copia", id: "../fora", canal: "x", copia }, 1_000)).rejects.toThrow()
    expect(await caixa.varrer(1_000 + 89 * 24 * HORA_MS, 90)).toBe(0)
    expect(await caixa.varrer(1_000 + 91 * 24 * HORA_MS, 90)).toBe(2)
    rmSync(pasta, { recursive: true, force: true })
  })
})
