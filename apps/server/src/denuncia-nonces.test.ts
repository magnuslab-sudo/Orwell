import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { assinarPedido } from "@enclave/client-core"
import { generateIdentity, parseServerName, ROTAS_DA_DENUNCIA } from "@enclave/protocol"
import { buildServer, type Enclave } from "./app.js"
import type { ServerConfig } from "./config.js"
import { PEDIDOS_DA_CAIXA_POR_HORA } from "./denuncia.js"

/**
 * Nonces and caps: a request the cap rejects leaves no nonce in memory.
 * A dedicated server, so the map starts empty. Real identities signing through
 * the client core.
 */

const SERVIDOR = "localhost:8999"

let enclave: Enclave
let dataDir: string

beforeAll(async () => {
  dataDir = mkdtempSync(join(tmpdir(), "enclave-denuncia-nonces-"))
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

describe("nonces das denúncias", () => {
  it("100 pedidos à caixa da mesma conta: do 61.º em diante 429, e só os 60 aceites ficam no mapa", async () => {
    const identidade = generateIdentity(parseServerName(SERVIDOR))
    enclave.store.registerOrVerifyAccount(identidade.address, identidade.signingPublicKey)
    expect(enclave.nonces.tamanho).toBe(0)

    const estados: number[] = []
    for (let i = 0; i < 100; i++) {
      const resposta = await enclave.app.inject({
        method: "POST",
        url: ROTAS_DA_DENUNCIA.caixa,
        payload: assinarPedido(identidade, ROTAS_DA_DENUNCIA.caixa, { vistos: [] }),
      })
      estados.push(resposta.statusCode)
    }

    expect(estados.slice(0, PEDIDOS_DA_CAIXA_POR_HORA).every((estado) => estado === 200)).toBe(true)
    expect(estados.slice(PEDIDOS_DA_CAIXA_POR_HORA).every((estado) => estado === 429)).toBe(true)
    expect(enclave.nonces.tamanho).toBe(PEDIDOS_DA_CAIXA_POR_HORA)
  })

  it("um pedido recusado pelo tecto não fica registado: repetido tal qual dá 429 outra vez, não 401", async () => {
    // It was not recorded, so it is not a replay. The account cap is still full,
    // so it returns 429 again, and the map does not grow.
    const identidade = generateIdentity(parseServerName(SERVIDOR))
    enclave.store.registerOrVerifyAccount(identidade.address, identidade.signingPublicKey)
    const antes = enclave.nonces.tamanho
    const pedido = (): object => assinarPedido(identidade, ROTAS_DA_DENUNCIA.caixa, { vistos: [] })
    for (let i = 0; i < PEDIDOS_DA_CAIXA_POR_HORA; i++) {
      await enclave.app.inject({ method: "POST", url: ROTAS_DA_DENUNCIA.caixa, payload: pedido() })
    }
    const recusado = pedido()
    for (let i = 0; i < 2; i++) {
      const resposta = await enclave.app.inject({ method: "POST", url: ROTAS_DA_DENUNCIA.caixa, payload: recusado })
      expect(resposta.statusCode).toBe(429)
    }
    expect(enclave.nonces.tamanho).toBe(antes + PEDIDOS_DA_CAIXA_POR_HORA)
  })
})
