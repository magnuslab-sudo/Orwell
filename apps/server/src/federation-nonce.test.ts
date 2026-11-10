import {
  FEDERATION_PATH,
  fromBase64,
  parseServerName,
  signEnvelope,
  signPeerClaim,
  toBase64,
  type FederationBody,
  type FederationEnvelope,
  type PeerClaim,
} from "@enclave/protocol"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { DatabaseSync } from "node:sqlite"
import { afterEach, describe, expect, it } from "vitest"
import { buildServer, type Enclave } from "./app.js"
import { loadOrCreateServerKey, type ServerConfig } from "./config.js"
import { currentSecond } from "./db.js"
import { Federation } from "./federation.js"

/**
 * FED-01 (external audit of 1.1.0, addendum of 3/11/2026): invalid federated
 * signatures burned persistent nonces.
 *
 * `verifySignedHeader` checked the nonce BEFORE verifying the signature, and
 * the check was `recordNonce`, which writes to SQLite. An envelope with a bad
 * signature wrote a row to `federation_nonces` and burned the nonce: the genuine
 * envelope with that nonce was then refused as a replay. The nonce had no size
 * limit. Federation is off by default (and off in production): this only
 * matters with an allowlist.
 */

const NOS = parseServerName("casa.example")
const PAR = parseServerName("par.example")
const CANAL = "!sala:casa.example"
const CORPO: FederationBody = { channel: CANAL, kind: "application", ciphertext: "bXVpdG8tc2VjcmV0bw" }

let enclave: Enclave
let baseDeDados: string
const porLimpar: string[] = []

async function montar(): Promise<ReturnType<typeof loadOrCreateServerKey>> {
  const dataDir = mkdtempSync(join(tmpdir(), "enclave-nonce-"))
  porLimpar.push(dataDir)
  baseDeDados = join(dataDir, "test.sqlite")
  const config: ServerConfig = {
    serverName: NOS,
    bindHost: "127.0.0.1",
    bindPort: 0,
    dataDir,
    databasePath: baseDeDados,
    sfuPort: 0,
    sfuAnnouncedIp: "",
    retentionDays: 30,
    allowlist: [PAR],
    turnUrls: [],
    turnSecret: "",
    turnTtl: 600,
    communityMode: false,
    commonRoom: "",
  }
  enclave = await buildServer(config)
  const remotoDir = mkdtempSync(join(tmpdir(), "enclave-par-"))
  porLimpar.push(remotoDir)
  const chave = loadOrCreateServerKey(remotoDir)
  // The peer key cached, as `#ensurePeerKey` would leave it: a test does not go to the directory over HTTPS.
  enclave.store.cachePeerKey(PAR, chave.keyId, chave.publicKey, currentSecond() + 3600)
  return chave
}

afterEach(async () => {
  await enclave?.close()
  for (const dir of porLimpar.splice(0)) rmSync(dir, { recursive: true, force: true })
})

const novoNonce = (): string => toBase64(crypto.getRandomValues(new Uint8Array(16)))

function envelope(chave: ReturnType<typeof loadOrCreateServerKey>, nonce = novoNonce()): FederationEnvelope {
  return signEnvelope(
    { keyId: chave.keyId, privateKey: chave.privateKey },
    { origin: PAR, destination: NOS, issuedAt: currentSecond(), nonce, body: CORPO },
  )
}

/** The same frame with the signature swapped for one that does not check out. */
function comAssinaturaMa(original: FederationEnvelope): FederationEnvelope {
  const bytes = fromBase64(original.signature)
  bytes[0] = (bytes[0] as number) ^ 0xff
  return { ...original, signature: toBase64(bytes) }
}

async function entregar(corpo: FederationEnvelope | Record<string, unknown>): Promise<{ estado: number; erro: string | undefined }> {
  const resposta = await enclave.app.inject({ method: "POST", url: `${FEDERATION_PATH}/send`, payload: corpo as Record<string, unknown> })
  return { estado: resposta.statusCode, erro: (resposta.json() as { error?: string }).error }
}

async function pedirPacote(pedido: PeerClaim | Record<string, unknown>): Promise<number> {
  const resposta = await enclave.app.inject({ method: "POST", url: `${FEDERATION_PATH}/keypackage`, payload: pedido as Record<string, unknown> })
  return resposta.statusCode
}

/** The rows of the nonces table, read from outside as an operator would read them. */
function nonces(): { origin: string; nonce: string }[] {
  const leitor = new DatabaseSync(baseDeDados, { readOnly: true })
  try {
    return leitor.prepare("SELECT origin, nonce FROM federation_nonces ORDER BY nonce").all() as { origin: string; nonce: string }[]
  } finally {
    leitor.close()
  }
}

describe("FED-01: a assinatura antes do nonce", () => {
  it("uma assinatura má deixa a tabela dos nonces igual, e o envelope verdadeiro com esse nonce entra depois", async () => {
    const chave = await montar()
    const antes = nonces()
    const bom = envelope(chave)
    expect(await entregar(comAssinaturaMa(bom))).toEqual({ estado: 403, erro: "bad-signature" })
    expect(nonces()).toEqual(antes)
    // The nonce was not burned: the genuine envelope gets through.
    expect((await entregar(bom)).estado).toBe(200)
    expect(nonces()).toHaveLength(antes.length + 1)
  })

  it("o mesmo vale para o pedido de key package entre servidores", async () => {
    const chave = await montar()
    const antes = nonces()
    const pedido = signPeerClaim(
      { keyId: chave.keyId, privateKey: chave.privateKey },
      { origin: PAR, destination: NOS, issuedAt: currentSecond(), nonce: novoNonce(), address: "@x:casa.example" },
    )
    const bytes = fromBase64(pedido.signature)
    bytes[0] = (bytes[0] as number) ^ 0xff
    expect(await pedirPacote({ ...pedido, signature: toBase64(bytes) })).toBe(403)
    expect(nonces()).toEqual(antes)
  })

  it("dois usos concorrentes do mesmo nonce válido: entra um só", async () => {
    const chave = await montar()
    const bom = envelope(chave)
    const respostas = await Promise.all([entregar(bom), entregar(bom), entregar(bom)])
    expect(respostas.filter((r) => r.estado === 200)).toHaveLength(1)
    expect(respostas.filter((r) => r.erro === "replay")).toHaveLength(2)
    expect(nonces().filter((n) => n.nonce === bom.nonce)).toHaveLength(1)
  })
})

describe("FED-01: o tamanho e a forma do nonce", () => {
  it("um nonce de 4 KiB é recusado pelo molde, e não escreve nada", async () => {
    const chave = await montar()
    const antes = nonces()
    expect((await entregar(envelope(chave, "a".repeat(4096)))).estado).toBe(400)
    expect(nonces()).toEqual(antes)
  })

  it("um nonce que não é base64url, ou é curto demais, é recusado pelo molde", async () => {
    const chave = await montar()
    const antes = nonces()
    expect((await entregar(envelope(chave, "não é base64 / nem perto"))).estado).toBe(400)
    expect((await entregar(envelope(chave, "abc"))).estado).toBe(400)
    expect(nonces()).toEqual(antes)
  })
})

describe("FED-01: limites por origem", () => {
  it("acima de ENVELOPES_POR_ORIGEM_POR_MINUTO, a origem recebe 429 até passar o minuto, e nada se escreve", async () => {
    const chave = await montar()
    const tecto = Federation.ENVELOPES_POR_ORIGEM_POR_MINUTO
    Federation.ENVELOPES_POR_ORIGEM_POR_MINUTO = 3
    try {
      for (let i = 0; i < 3; i++) expect((await entregar(envelope(chave))).estado).toBe(200)
      const antes = nonces()
      expect(await entregar(envelope(chave))).toEqual({ estado: 429, erro: "rate-limited" })
      expect(nonces()).toEqual(antes)
    } finally {
      Federation.ENVELOPES_POR_ORIGEM_POR_MINUTO = tecto
    }
  })

  it("um envelope com uma chave desconhecida não vai à directoria do par mais do que o tecto por minuto", async () => {
    await montar()
    const pedidos: string[] = []
    const fetchOriginal = globalThis.fetch
    globalThis.fetch = (async (url: string | URL | Request) => {
      pedidos.push(String(url))
      return new Response("{}", { status: 404 })
    }) as typeof fetch
    try {
      const outraDir = mkdtempSync(join(tmpdir(), "enclave-outra-"))
      porLimpar.push(outraDir)
      const outra = loadOrCreateServerKey(outraDir)
      for (let i = 0; i < Federation.DIRECTORIAS_POR_ORIGEM_POR_MINUTO + 5; i++) {
        const desconhecida = signEnvelope(
          { keyId: `k${i}`, privateKey: outra.privateKey },
          { origin: PAR, destination: NOS, issuedAt: currentSecond(), nonce: novoNonce(), body: CORPO },
        )
        expect((await entregar(desconhecida)).erro).toBe("unknown-key")
      }
      expect(pedidos.length).toBeLessThanOrEqual(Federation.DIRECTORIAS_POR_ORIGEM_POR_MINUTO)
    } finally {
      globalThis.fetch = fetchOriginal
    }
  })
})

