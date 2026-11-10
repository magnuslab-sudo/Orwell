import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { DatabaseSync } from "node:sqlite"
import { join } from "node:path"
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import { assinarPedido } from "@enclave/client-core"
import { generateIdentity, parseServerName, ROTAS_DA_DENUNCIA, toBase64, type AccountIdentity, type PedidoAssinado } from "@enclave/protocol"
import { buildServer, type Enclave } from "./app.js"
import { loadConfig, type ServerConfig } from "./config.js"
import {
  ArquivoDeDenuncias,
  ATRASO_DA_RESPOSTA_MS,
  DENUNCIA_MAX_BYTES,
  DENUNCIAS_POR_HORA,
  DENUNCIAS_POR_HORA_POR_IP,
  lerCorpoDaDenuncia,
  nomeDoFicheiroDaConta,
  type DenunciaGuardada,
} from "./denuncia.js"

/**
 * `POST /_enclave/denuncia`, via `inject`, with real identities signing through
 * the client core. No network format built by hand: the request comes from
 * `assinarPedido`, like in the app.
 */

const SERVIDOR = "localhost:8999"
const HORA_MS = 3_600_000
const DIA_MS = 24 * HORA_MS

let enclave: Enclave
let dataDir: string

beforeAll(async () => {
  dataDir = mkdtempSync(join(tmpdir(), "enclave-denuncia-"))
  const config: ServerConfig = {
    serverName: parseServerName(SERVIDOR),
    bindHost: "127.0.0.1",
    bindPort: 0,
    dataDir,
    databasePath: join(dataDir, "test.sqlite"),
    sfuPort: 0,
    sfuAnnouncedIp: "",
    retentionDays: 30,
    allowlist: [],
    turnUrls: [],
    turnSecret: "",
    turnTtl: 600,
    communityMode: false,
    commonRoom: "",
  }
  enclave = await buildServer(config)
}, 30_000)

afterAll(async () => {
  await enclave?.close()
  rmSync(dataDir, { recursive: true, force: true })
})

// Only the clock and setTimeout: setImmediate stays real, so the test can wait
// for the request to reach the response delay.
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] })
})
afterEach(() => {
  vi.useRealTimers()
})

const pasta = (): string => join(dataDir, "denuncias")
const ficheirosDeDenuncia = (): string[] =>
  existsSync(pasta()) ? readdirSync(pasta()).filter((nome) => /^\d+\.json$/.test(nome)) : []

/** An account that already logged in on this server: the signed request only reads the base. */
function conta(): AccountIdentity {
  const identidade = generateIdentity(parseServerName(SERVIDOR))
  enclave.store.registerOrVerifyAccount(identidade.address, identidade.signingPublicKey)
  return identidade
}

let ipSeguinte = 1
/** An IP just for the test, so one account's limits do not count toward the others. */
const ipNovo = (): string => `198.51.100.${ipSeguinte++}`

function corpoValido(denunciado: string, mudar: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    v: 1,
    motivo: 3,
    nota: "Insultos repetidos.",
    boaFe: true,
    canal: `#espaco:${SERVIDOR}`,
    sala: "geral",
    denunciado,
    alvo: { tipo: "mensagem", id: "m-1" },
    itens: [{ s: 1, a: denunciado, p: { t: "texto da mensagem" } }],
    denunciada: 0,
    versao: "1.1.0",
    fundador: null,
    copia: null,
    ...mudar,
  }
}

interface Resposta {
  statusCode: number
  corpo: unknown
  /** Milliseconds of fake clock time between the request waiting and the response. */
  atraso: number
}

/**
 * Send the request and drive the fake clock until the response. The delay is measured
 * from when the server sets the timer until it fires.
 */
async function enviar(pedido: PedidoAssinado | Record<string, unknown>, ip: string): Promise<Resposta> {
  let feito = false
  const promessa = enclave.app
    .inject({ method: "POST", url: ROTAS_DA_DENUNCIA.enviar, payload: pedido as object, remoteAddress: ip })
    .finally(() => {
      feito = true
    })
  let atraso = 0
  while (!feito) {
    if (vi.getTimerCount() > 0) {
      const antes = Date.now()
      await vi.runOnlyPendingTimersAsync()
      atraso += Date.now() - antes
    } else {
      await new Promise<void>((resolver) => setImmediate(resolver))
    }
  }
  const resposta = await promessa
  return { statusCode: resposta.statusCode, corpo: resposta.json(), atraso }
}

function denunciar(quem: AccountIdentity, corpo: unknown, ip: string): Promise<Resposta> {
  return enviar(assinarPedido(quem, ROTAS_DA_DENUNCIA.enviar, corpo), ip)
}

function lerGuardada(numero: number): DenunciaGuardada {
  return JSON.parse(readFileSync(join(pasta(), `${numero}.json`), "utf8")) as DenunciaGuardada
}

function numeroMaisAlto(): number {
  return Math.max(...ficheirosDeDenuncia().map((nome) => Number(nome.slice(0, -5))))
}

describe("POST /_enclave/denuncia", () => {
  it("guarda a denúncia em denuncias/<numero>.json com denunciante, motivo, prioridade e sem cópia nem aparelho", async () => {
    const ana = conta()
    const bruno = conta()
    const copia = { v: 1, e: "A".repeat(43), n: "B".repeat(32), c: "cifrado" }
    // A broken app that sends the device name: the schema throws it out.
    const corpo = corpoValido(bruno.address, { motivo: 2, copia, fundador: bruno.address, aparelho: "iPhone da Ana" })
    const resposta = await denunciar(ana, corpo, ipNovo())
    expect(resposta.statusCode).toBe(200)

    const numero = numeroMaisAlto()
    const caminho = join(pasta(), `${numero}.json`)
    expect(statSync(caminho).mode & 0o777).toBe(0o600)
    const texto = readFileSync(caminho, "utf8")
    const guardada = JSON.parse(texto) as DenunciaGuardada
    expect(guardada).toMatchObject({
      v: 1,
      numero,
      denunciante: ana.address,
      prioridade: "alta",
      art18: true,
      estado: "aberta",
      // The test item is not a type with authorship: no proof, and the report stays.
      verificacao: { geral: "nao-verificada", itens: [{ indice: 0, autor: bruno.address, veredicto: "esquema" }] },
    })
    expect(guardada.corpo.motivo).toBe(2)
    expect(guardada.corpo.denunciado).toBe(bruno.address)
    expect(new Date(guardada.recebida).toISOString()).toBe(guardada.recebida)
    // Not the founder's copy, not the device, not the IP.
    expect(texto).not.toContain('"copia"')
    expect(texto).not.toContain("cifrado")
    expect(texto).not.toContain("iPhone da Ana")
    expect(texto).not.toContain(toBase64(ana.deviceSigningPublicKey))
    expect(texto).not.toContain("198.51.100.")
  })

  it("a resposta é 200 {} com atraso dentro da janela para alvo que existe e para alvo que não existe", async () => {
    const ana = conta()
    const existe = conta()
    const naoExiste = generateIdentity(parseServerName(SERVIDOR))
    const ip = ipNovo()
    const a = await denunciar(ana, corpoValido(existe.address), ip)
    const b = await denunciar(ana, corpoValido(naoExiste.address), ip)
    expect(a.statusCode).toBe(200)
    expect(b.statusCode).toBe(a.statusCode)
    expect(a.corpo).toEqual({})
    expect(b.corpo).toEqual(a.corpo)
    for (const { atraso } of [a, b]) {
      expect(atraso).toBeGreaterThanOrEqual(ATRASO_DA_RESPOSTA_MS[0])
      expect(atraso).toBeLessThanOrEqual(ATRASO_DA_RESPOSTA_MS[1])
    }
  })

  it("cinquenta denúncias da mesma conta não suspendem ninguém", async () => {
    const ana = conta()
    const bruno = conta()
    const ip = ipNovo()
    const antes = ficheirosDeDenuncia().length
    let aceites = 0
    for (let hora = 0; aceites < 50; hora++) {
      // More than an hour simulated: the address limit is per hour.
      vi.setSystemTime(Date.now() + HORA_MS + 1)
      for (let i = 0; i < DENUNCIAS_POR_HORA && aceites < 50; i++) {
        const resposta = await denunciar(ana, corpoValido(bruno.address), ip)
        expect(resposta.statusCode).toBe(200)
        aceites += 1
      }
    }
    expect(ficheirosDeDenuncia().length - antes).toBe(50)
    // No count is suspended: only one person, by the VPS script, writes here.
    expect(enclave.store.estaSuspensa(bruno.address)).toBe(false)
    const base = new DatabaseSync(join(dataDir, "test.sqlite"), { readOnly: true })
    try {
      expect(base.prepare("SELECT count(*) AS n FROM suspensoes").get()).toEqual({ n: 0 })
    } finally {
      base.close()
    }
    const suspensoes = join(pasta(), "suspensoes")
    expect(existsSync(suspensoes) ? readdirSync(suspensoes) : []).toEqual([])
  }, 60_000)

  it("tectos: 5 por hora por endereço e 20 por IP dão 429", async () => {
    const bruno = conta()
    // Per address: the sixth for the same account, from different IPs.
    const ana = conta()
    for (let i = 0; i < DENUNCIAS_POR_HORA; i++) {
      expect((await denunciar(ana, corpoValido(bruno.address), ipNovo())).statusCode).toBe(200)
    }
    const sexta = await denunciar(ana, corpoValido(bruno.address), ipNovo())
    expect(sexta.statusCode).toBe(429)
    expect(sexta.corpo).toEqual({ error: "too-many-reports" })

    // By IP: different accounts, all from the same IP.
    const ip = ipNovo()
    for (let i = 0; i < DENUNCIAS_POR_HORA_POR_IP; i++) {
      expect((await denunciar(conta(), corpoValido(bruno.address), ip)).statusCode).toBe(200)
    }
    expect((await denunciar(conta(), corpoValido(bruno.address), ip)).statusCode).toBe(429)
  }, 60_000)

  it("mal formado dá 400: motivo 9, motivo 8 sem nota, motivo 3 sem boaFe, mais de 16 itens", async () => {
    const bruno = conta()
    const item = { s: 1, a: bruno.address, p: {} }
    const antes = ficheirosDeDenuncia().length
    for (const mudar of [
      { motivo: 9 },
      { motivo: 8, nota: "" },
      { motivo: 8, nota: "   " },
      { motivo: 3, boaFe: false },
      { itens: Array.from({ length: 17 }, () => item) },
      { denunciada: 5 },
      { alvo: { tipo: "outro" } },
    ]) {
      const resposta = await denunciar(conta(), corpoValido(bruno.address, mudar), ipNovo())
      expect(resposta.statusCode, JSON.stringify(mudar)).toBe(400)
      expect(resposta.corpo).toEqual({ error: "malformed-report" })
    }
    expect(ficheirosDeDenuncia().length).toBe(antes)
    // Reason 1 does not require good faith (art. 16, para. 2 of the DSA does not apply there).
    expect((await denunciar(conta(), corpoValido(bruno.address, { motivo: 1, boaFe: false, nota: "" }), ipNovo())).statusCode).toBe(200)
  })

  it("lerCorpoDaDenuncia nunca lança, seja qual for a entrada", () => {
    for (const lixo of [undefined, null, 0, "texto", [], { v: 2 }, { v: 1, motivo: "3" }, Object.create(null)]) {
      expect(lerCorpoDaDenuncia(lixo)).toBeNull()
    }
  })

  it("maior que 512 KiB dá 413 e não escreve nada", async () => {
    const bruno = conta()
    const grande = "x".repeat(40 * 1024)
    const itens = Array.from({ length: 16 }, (_, s) => ({ s, a: bruno.address, p: { t: grande } }))
    const antes = ficheirosDeDenuncia().length
    const resposta = await denunciar(conta(), corpoValido(bruno.address, { itens }), ipNovo())
    expect(JSON.stringify(itens).length).toBeGreaterThan(DENUNCIA_MAX_BYTES)
    expect(resposta.statusCode).toBe(413)
    expect(resposta.corpo).toEqual({ error: "report-too-large" })
    expect(ficheirosDeDenuncia().length).toBe(antes)
  })

  it("sem assinatura válida dá 401 e não escreve nada", async () => {
    const ana = conta()
    const bruno = conta()
    const antes = ficheirosDeDenuncia().length

    // Body changed after signing.
    const pedido = assinarPedido(ana, ROTAS_DA_DENUNCIA.enviar, corpoValido(bruno.address))
    const trocado = await enviar({ ...pedido, corpo: corpoValido(ana.address) }, ipNovo())
    expect(trocado.statusCode).toBe(401)
    expect(trocado.corpo).toEqual({ error: "unauthorized" })

    // Account that never logged in: same response, without stating which check failed.
    const estranha = generateIdentity(parseServerName(SERVIDOR))
    const desconhecida = await denunciar(estranha, corpoValido(bruno.address), ipNovo())
    expect(desconhecida.statusCode).toBe(401)
    expect(desconhecida.corpo).toEqual(trocado.corpo)

    // Garbage does not pass the signature.
    expect((await enviar({ ola: 1 }, ipNovo())).statusCode).toBe(401)

    // Device clock is wrong: the app shows "device clock is incorrect".
    const atrasado = assinarPedido(ana, ROTAS_DA_DENUNCIA.enviar, corpoValido(bruno.address), Date.now() - 20 * 60_000)
    const velho = await enviar(atrasado, ipNovo())
    expect(velho.statusCode).toBe(401)
    expect(velho.corpo).toEqual({ error: "stale-request" })

    // Signed for a different route.
    const outraRota = assinarPedido(ana, ROTAS_DA_DENUNCIA.revisao, corpoValido(bruno.address))
    expect((await enviar(outraRota, ipNovo())).statusCode).toBe(401)

    expect(ficheirosDeDenuncia().length).toBe(antes)
  })

  it("se a fila falha depois de a denúncia estar guardada, a resposta continua 200 {} depois do atraso", async () => {
    const falha = vi.spyOn(ArquivoDeDenuncias.prototype, "escreverFila").mockRejectedValueOnce(new Error("disco cheio"))
    const erros = vi.spyOn(process.stderr, "write").mockImplementation(() => true)
    try {
      const antes = ficheirosDeDenuncia().length
      const resposta = await denunciar(conta(), corpoValido(conta().address), ipNovo())
      expect(resposta.statusCode).toBe(200)
      expect(resposta.corpo).toEqual({})
      expect(resposta.atraso).toBeGreaterThanOrEqual(ATRASO_DA_RESPOSTA_MS[0])
      expect(ficheirosDeDenuncia().length).toBe(antes + 1)
      expect(falha).toHaveBeenCalledTimes(1)
      expect(erros.mock.calls.some(([texto]) => String(texto).includes("disco cheio"))).toBe(true)
    } finally {
      falha.mockRestore()
      erros.mockRestore()
    }
  })

  it("fila.json lista as abertas com as prioritárias primeiro e sem conteúdo", async () => {
    const bruno = conta()
    const ip = ipNovo()
    for (const motivo of [5, 1, 3, 2]) {
      expect((await denunciar(conta(), corpoValido(bruno.address, { motivo, nota: "segredo da nota" }), ip)).statusCode).toBe(200)
    }
    const texto = readFileSync(join(pasta(), "fila.json"), "utf8")
    expect(texto).not.toContain("segredo da nota")
    expect(texto).not.toContain(bruno.address)
    const fila = JSON.parse(texto) as { v: 1; abertas: Record<string, unknown>[]; revisoesPendentes: number; actualizada: string }
    expect(fila.v).toBe(1)
    expect(fila.revisoesPendentes).toBe(0)
    expect(fila.abertas.length).toBe(ficheirosDeDenuncia().length)
    for (const entrada of fila.abertas) {
      expect(Object.keys(entrada).sort()).toEqual(["art18", "motivo", "numero", "prioridade", "recebida"])
    }
    const prioridades = fila.abertas.map((entrada) => entrada.prioridade)
    expect(prioridades.lastIndexOf("alta")).toBeLessThan(prioridades.indexOf("normal"))
    // Within the same priority, oldest first.
    const numerosAltos = fila.abertas.filter((entrada) => entrada.prioridade === "alta").map((entrada) => entrada.numero as number)
    expect(numerosAltos).toEqual([...numerosAltos].sort((x, y) => x - y))
  })

  it("revisoesPendentes conta-se pelos ficheiros: uma fila velha ou errada acerta-se com a denúncia seguinte (R35)", async () => {
    const revisoes = join(pasta(), "revisoes")
    mkdirSync(revisoes, { recursive: true })
    const nome = nomeDoFicheiroDaConta("@r35:orwell.pt")
    const pedido = { v: 1, endereco: "@r35:orwell.pt", recebido: "2026-11-04T10:00:00.000Z", nota: "x" }
    writeFileSync(join(revisoes, `${nome}-1.json`), JSON.stringify(pedido))
    writeFileSync(join(revisoes, `${nome}-2.json`), JSON.stringify(pedido))
    // Decided by the VPS script: no longer counts.
    writeFileSync(join(revisoes, `${nome}-3.json`), JSON.stringify({ ...pedido, decidida: "2026-11-04T11:00:00.000Z", decisao: "mantida" }))
    writeFileSync(join(revisoes, `${nome}-4.json`), "ilegível")
    const esperado = readdirSync(revisoes).filter((ficheiro) => {
      try {
        return (JSON.parse(readFileSync(join(revisoes, ficheiro), "utf8")) as { decidida?: string }).decidida === undefined
      } catch {
        return false
      }
    }).length
    expect(esperado).toBeGreaterThanOrEqual(2)

    for (const velha of [{ v: 1, abertas: [], revisoesPendentes: 41, actualizada: "2026-01-01T00:00:00.000Z" }, null]) {
      if (velha) writeFileSync(join(pasta(), "fila.json"), JSON.stringify(velha))
      else rmSync(join(pasta(), "fila.json"))
      expect((await denunciar(conta(), corpoValido(conta().address), ipNovo())).statusCode).toBe(200)
      const fila = JSON.parse(readFileSync(join(pasta(), "fila.json"), "utf8")) as { revisoesPendentes: number }
      expect(fila.revisoesPendentes).toBe(esperado)
    }
  })
})

describe("ArquivoDeDenuncias", () => {
  let dir: string
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "enclave-arquivo-"))
  })
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  function base(denunciado: string, mudar: Partial<Omit<DenunciaGuardada, "numero">> = {}): Omit<DenunciaGuardada, "numero"> {
    const corpo = lerCorpoDaDenuncia(corpoValido(denunciado))
    if (!corpo) throw new Error("corpo de teste inválido")
    const { copia: _copia, ...semCopia } = corpo
    return {
      v: 1,
      recebida: new Date(0).toISOString(),
      denunciante: `@ana:${SERVIDOR}`,
      prioridade: "normal",
      art18: false,
      estado: "aberta",
      verificacao: { geral: "nao-verificada", itens: [] },
      corpo: semCopia,
      ...mudar,
    }
  }

  it("numera em sequência, mesmo com guardar em paralelo e depois de reabrir a pasta", async () => {
    const arquivo = new ArquivoDeDenuncias(dir)
    const guardadas = await Promise.all([1, 2, 3].map(() => arquivo.guardar(base(`@bruno:${SERVIDOR}`))))
    expect(guardadas.map((d) => d.numero).sort()).toEqual([1, 2, 3])
    const outra = new ArquivoDeDenuncias(dir)
    expect((await outra.guardar(base(`@bruno:${SERVIDOR}`))).numero).toBe(4)
    expect((await outra.ler(2))?.numero).toBe(2)
    expect(await outra.ler(99)).toBeNull()
    expect((await outra.listar()).map((d) => d.numero)).toEqual([1, 2, 3, 4])
  })

  it("varrer apaga as fechadas há mais de 90 dias e mantém abertas", async () => {
    const arquivo = new ArquivoDeDenuncias(dir)
    const agora = Date.UTC(2027, 5, 1)
    const ha = (dias: number): string => new Date(agora - dias * DIA_MS).toISOString()
    const suspenso = `@carla:${SERVIDOR}`
    const abertaVelha = await arquivo.guardar(base(`@bruno:${SERVIDOR}`, { recebida: ha(400) }))
    const fechadaVelha = await arquivo.guardar(
      base(`@bruno:${SERVIDOR}`, { recebida: ha(200), estado: "fechada", fechada: ha(91), decisao: "sem-accao" }),
    )
    const fechadaRecente = await arquivo.guardar(
      base(`@bruno:${SERVIDOR}`, { recebida: ha(30), estado: "fechada", fechada: ha(10), decisao: "sem-accao" }),
    )
    // Closed long ago, but the suspension it triggered remains: it stays.
    const comSuspensao = await arquivo.guardar(
      base(suspenso, { recebida: ha(200), estado: "fechada", fechada: ha(150), decisao: "suspensa" }),
    )
    mkdirSync(join(dir, "suspensoes"), { recursive: true })
    writeFileSync(
      join(dir, "suspensoes", `${nomeDoFicheiroDaConta(suspenso)}.json`),
      JSON.stringify({ v: 1, endereco: suspenso, revisao: { pedida: null, decisao: "pendente", nota: "" } }),
    )

    expect(await arquivo.varrer(agora, 90)).toBe(1)
    const restantes = (await arquivo.listar()).map((d) => d.numero)
    expect(restantes).toEqual([abertaVelha.numero, fechadaRecente.numero, comSuspensao.numero])
    expect(await arquivo.ler(fechadaVelha.numero)).toBeNull()

    // Suspension lifted, the report follows the 90-day rule.
    writeFileSync(
      join(dir, "suspensoes", `${nomeDoFicheiroDaConta(suspenso)}.json`),
      JSON.stringify({ v: 1, endereco: suspenso, revisao: { pedida: ha(140), decisao: "levantada", nota: "" } }),
    )
    expect(await arquivo.varrer(agora, 90)).toBe(1)
    expect(await arquivo.ler(comSuspensao.numero)).toBeNull()
  })

  it("passado o dia ate do aviso, a suspensão acabou e a denúncia segue a regra dos 90 dias", async () => {
    const arquivo = new ArquivoDeDenuncias(dir)
    const agora = Date.UTC(2027, 5, 1)
    const ha = (dias: number): string => new Date(agora - dias * DIA_MS).toISOString()
    const suspenso = `@carla:${SERVIDOR}`
    const comSuspensao = await arquivo.guardar(
      base(suspenso, { recebida: ha(200), estado: "fechada", fechada: ha(150), decisao: "suspensa" }),
    )
    mkdirSync(join(dir, "suspensoes"), { recursive: true })
    const aviso = (ate: string): string =>
      JSON.stringify({ v: 1, endereco: suspenso, ate, revisao: { pedida: null, decisao: "pendente", nota: "" } })
    // It ends tomorrow: still active, it stays.
    writeFileSync(join(dir, "suspensoes", `${nomeDoFicheiroDaConta(suspenso)}.json`), aviso(ha(-1).slice(0, 10)))
    expect(await arquivo.varrer(agora, 90)).toBe(0)
    // It ended 100 days ago: finished, and deleted.
    writeFileSync(join(dir, "suspensoes", `${nomeDoFicheiroDaConta(suspenso)}.json`), aviso(ha(100).slice(0, 10)))
    expect(await arquivo.varrer(agora, 90)).toBe(1)
    expect(await arquivo.ler(comSuspensao.numero)).toBeNull()
  })
})

describe("config das denúncias", () => {
  it("ausentes são 90 dias e 1-6 horas; lê o que o operador escreveu; recusa lixo no arranque", () => {
    expect(loadConfig({}).denunciasDias).toBe(90)
    expect(loadConfig({}).denunciaAtrasoHoras).toEqual([1, 6])
    expect(loadConfig({ ENCLAVE_DENUNCIAS_DIAS: " 120 " }).denunciasDias).toBe(120)
    expect(loadConfig({ ENCLAVE_DENUNCIA_ATRASO_HORAS: "2-12" }).denunciaAtrasoHoras).toEqual([2, 12])
    for (const lixo of ["0", "-1", "1.5", "noventa"]) {
      expect(() => loadConfig({ ENCLAVE_DENUNCIAS_DIAS: lixo }), lixo).toThrow(/ENCLAVE_DENUNCIAS_DIAS/)
    }
    for (const lixo of ["6-1", "1", "1-", "um-seis", "1-6-9"]) {
      expect(() => loadConfig({ ENCLAVE_DENUNCIA_ATRASO_HORAS: lixo }), lixo).toThrow(/ENCLAVE_DENUNCIA_ATRASO_HORAS/)
    }
  })
})
