import { mkdtempSync, readdirSync, readFileSync, rmSync, utimesSync, writeFileSync, mkdirSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { parseServerName } from "@enclave/protocol"
import { buildServer, type Enclave } from "./app.js"
import type { ServerConfig } from "./config.js"
import {
  dataDoFicheiro,
  enderecoCurto,
  JanelaDeUmaHora,
  lerPedidoDeRelato,
  RELATO_MAX_BYTES,
  RELATOS_POR_HORA,
  varrerRelatos,
} from "./relato.js"

/**
 * "Send log" (phase 4 of the 0.9 settings): `POST /_enclave/relato`.
 *
 * Via `inject`, no port needed: the route is HTTP and requires no network.
 */

let enclave: Enclave
let dataDir: string

beforeAll(async () => {
  dataDir = mkdtempSync(join(tmpdir(), "enclave-relato-"))
  const config: ServerConfig = {
    serverName: parseServerName("localhost:8999"),
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

function enviar(corpo: unknown, ip = "203.0.113.1") {
  return enclave.app.inject({ method: "POST", url: "/_enclave/relato", payload: corpo as object, remoteAddress: ip })
}

const pasta = (): string => join(dataDir, "relatos")

describe("POST /_enclave/relato", () => {
  it("guarda o registo em relatos/<data>-<endereço curto>.txt, com o endereço e a versão", async () => {
    const resposta = await enviar({ endereco: "@ana:orwell.pt", versao: "0.9.2", texto: "linha 1\nlinha 2" })
    expect(resposta.statusCode).toBe(200)
    expect(resposta.json()).toEqual({ ok: true })
    const nome = `${dataDoFicheiro(new Date())}-ana.txt`
    expect(readdirSync(pasta())).toContain(nome)
    const guardado = readFileSync(join(pasta(), nome), "utf8")
    expect(guardado).toContain("@ana:orwell.pt")
    expect(guardado).toContain("versão 0.9.2")
    expect(guardado).toContain("linha 1\nlinha 2")
  })

  it("dois registos no mesmo dia juntam-se no mesmo ficheiro, um a seguir ao outro", async () => {
    await enviar({ endereco: "@bea:orwell.pt", versao: "0.9.2", texto: "primeiro" }, "203.0.113.2")
    await enviar({ endereco: "@bea:orwell.pt", versao: "0.9.2", texto: "segundo" }, "203.0.113.2")
    const guardado = readFileSync(join(pasta(), `${dataDoFicheiro(new Date())}-bea.txt`), "utf8")
    expect(guardado.indexOf("primeiro")).toBeLessThan(guardado.indexOf("segundo"))
  })

  it("recusa o que não é um registo: sem endereço, endereço de canal, versão estranha, texto vazio", async () => {
    for (const corpo of [
      { versao: "0.9.2", texto: "x" },
      { endereco: "!canal:orwell.pt", versao: "0.9.2", texto: "x" },
      { endereco: "@ana:orwell.pt", versao: "../../etc", texto: "x" },
      { endereco: "@ana:orwell.pt", versao: "0.9.2", texto: "" },
    ]) {
      expect((await enviar(corpo, "203.0.113.3")).statusCode).toBe(400)
    }
  })

  it("recusa acima de 64 kB de texto", async () => {
    const resposta = await enviar({ endereco: "@gil:orwell.pt", versao: "0.9.2", texto: "a".repeat(RELATO_MAX_BYTES + 1) }, "203.0.113.4")
    expect(resposta.statusCode).toBe(413)
    expect(readdirSync(pasta()).some((nome) => nome.endsWith("-gil.txt"))).toBe(false)
  })

  it("10 por hora por endereço; o 11.º leva 429", async () => {
    for (let i = 0; i < RELATOS_POR_HORA; i += 1) {
      // A different IP per request: what we measure here is the per-address cap.
      expect((await enviar({ endereco: "@rui:orwell.pt", versao: "0.9.2", texto: `n${i}` }, `198.51.100.${i}`)).statusCode).toBe(200)
    }
    const decimo = await enviar({ endereco: "@rui:orwell.pt", versao: "0.9.2", texto: "a mais" }, "198.51.100.200")
    expect(decimo.statusCode).toBe(429)
  })

  it("um IP que inventa um endereço a cada pedido também pára", async () => {
    const codigos: number[] = []
    for (let i = 0; i < 31; i += 1) {
      codigos.push((await enviar({ endereco: `@p${i}:orwell.pt`, versao: "0.9.2", texto: "x" }, "192.0.2.77")).statusCode)
    }
    expect(codigos.slice(0, 30).every((codigo) => codigo === 200)).toBe(true)
    expect(codigos[30]).toBe(429)
  })
})

describe("as peças da rota", () => {
  it("o endereço curto é seguro para um nome de ficheiro", () => {
    expect(enderecoCurto("@Duarte:orwell.pt")).toBe("duarte")
    expect(enderecoCurto("@../../x:orwell.pt")).toBe("______x")
    expect(enderecoCurto("@:orwell.pt")).toBe("anonimo")
  })

  it("a janela de uma hora esquece o que tem mais de uma hora", () => {
    const janela = new JanelaDeUmaHora(2)
    expect(janela.tentar("a", 0)).toBe(true)
    expect(janela.tentar("a", 1)).toBe(true)
    expect(janela.tentar("a", 2)).toBe(false)
    expect(janela.tentar("a", 3_600_001)).toBe(true)
  })

  it("lerPedidoDeRelato aceita só o que a app manda", () => {
    expect(lerPedidoDeRelato({ endereco: "@a:b.pt", versao: "0.9.2-beta.1", texto: "x" })).not.toBeNull()
    expect(lerPedidoDeRelato(null)).toBeNull()
    expect(lerPedidoDeRelato("texto")).toBeNull()
  })

  it("o varrimento apaga os registos com mais de 30 dias e deixa os outros", async () => {
    const aqui = mkdtempSync(join(tmpdir(), "enclave-relato-varre-"))
    mkdirSync(aqui, { recursive: true })
    writeFileSync(join(aqui, "2026-01-01-velho.txt"), "x")
    writeFileSync(join(aqui, "2026-10-27-novo.txt"), "x")
    const antigo = (Date.now() - 31 * 24 * 3_600_000) / 1000
    utimesSync(join(aqui, "2026-01-01-velho.txt"), antigo, antigo)
    expect(await varrerRelatos(aqui)).toBe(1)
    expect(readdirSync(aqui)).toEqual(["2026-10-27-novo.txt"])
    rmSync(aqui, { recursive: true, force: true })
  })
})
