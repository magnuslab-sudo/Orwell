import {
  FEDERATION_PATH,
  generateIdentity,
  parseServerName,
  signEnvelope,
  toBase64,
  type FederationBody,
  type FederationEnvelope,
  type ServerName,
} from "@enclave/protocol"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { createChannel, rotateEpoch } from "@enclave/crypto"
import { buildServer, type Enclave } from "./app.js"
import { loadOrCreateServerKey, type ServerConfig } from "./config.js"
import { currentSecond } from "./db.js"

/**
 * The allowlist on the DELIVERY side, the forgotten sister of the key package
 * route.
 *
 * Audit asked us to look at the route that serves key packages, and that got
 * covered in `federation-keypackage.test.ts`. When mutating `#allowed` to prove
 * those tests, the mutation fell by accident into the OTHER call, the
 * `receive` one, and the entire server test suite passed anyway: one hundred
 * sixty tests, none of them looking at the line that decides who can deliver
 * here. A guard without a test is a guard that the next cleanup erases.
 *
 * What it prevents is written in its comment and it is not small. An accepted
 * `receive` does three things, and the third is the one that hurts:
 *
 *  1. `appendEvent`, writes the event to the database, with retention paying
 *     for it.
 *  2. `broadcast`, pushes it to all subscribers of the channel.
 *  3. `addChannelPeer`, **enrolls the sender as a peer of that channel**, and
 *     from then on all FUTURE traffic of the channel gets forwarded to it.
 *
 * The third turns a delivery into a permanent subscription. MLS encryption
 * holds, whoever has no place in the group decrypts nothing, but the server
 * starts sending all channel messages to it, including welcomes, which carry the
 * address of who is entering. Whoever has a domain and a key signs their own way
 * in: the verification key comes from the directory that the sender ITSELF
 * publishes, so the signature proves no legitimacy, only that whoever signed
 * owns the name they said. The allowlist, and only it, separates a peer from a
 * stranger.
 */

const NOS = parseServerName("casa.example")
const PAR = parseServerName("par.example")
const ESTRANHO = parseServerName("estranho.example")

const CANAL = "!sala:casa.example"

let enclave: Enclave
let dataDir: string
const porLimpar: string[] = []

/** A server with its own key, like one on the other end of the wire. */
function servidorRemoto(): ReturnType<typeof loadOrCreateServerKey> {
  const dir = mkdtempSync(join(tmpdir(), "enclave-remoto-"))
  porLimpar.push(dir)
  return loadOrCreateServerKey(dir)
}

async function montar(allowlist: ServerName[]): Promise<void> {
  dataDir = mkdtempSync(join(tmpdir(), "enclave-entrega-"))
  porLimpar.push(dataDir)

  const config: ServerConfig = {
    serverName: NOS,
    bindHost: "127.0.0.1",
    bindPort: 0,
    dataDir,
    databasePath: join(dataDir, "test.sqlite"),
    sfuPort: 0,
    sfuAnnouncedIp: "",
    retentionDays: 30,
    allowlist,
    turnUrls: [],
    turnSecret: "",
    turnTtl: 600,
    communityMode: false,
    commonRoom: "",
  }
  enclave = await buildServer(config)
}

const CORPO: FederationBody = { channel: CANAL, kind: "application", ciphertext: "bXVpdG8tc2VjcmV0bw" }

/**
 * An envelope really signed by the key given to it.
 *
 * The key goes into cache BEFORE signing because, without it, the envelope dies
 * in `unknown-key` and the test passed without reaching the allowlist, the
 * right refusal for the wrong reason. It is the same cache that `#ensurePeerKey`
 * would fill by going to the peer's directory over HTTPS, which a test does not
 * do.
 */
function envelopeDe(origem: ServerName, chave = servidorRemoto(), corpo: FederationBody = CORPO): FederationEnvelope {
  enclave.store.cachePeerKey(origem, chave.keyId, chave.publicKey, currentSecond() + 3600)
  return signEnvelope(
    { keyId: chave.keyId, privateKey: chave.privateKey },
    {
      origin: origem,
      destination: NOS,
      issuedAt: currentSecond(),
      nonce: toBase64(crypto.getRandomValues(new Uint8Array(16))),
      body: corpo,
    },
  )
}

async function entregar(envelope: FederationEnvelope): Promise<number> {
  const resposta = await enclave.app.inject({
    method: "POST",
    url: `${FEDERATION_PATH}/send`,
    payload: envelope as unknown as Record<string, unknown>,
  })
  return resposta.statusCode
}

/** What the delivery left inside here: events written and peers subscribed. */
function rasto(): { eventos: number; pares: string[] } {
  const leitor = generateIdentity(NOS)
  return {
    eventos: enclave.store.backfill(CANAL, undefined, 100, leitor.address).length,
    pares: enclave.store.channelPeers(CANAL),
  }
}

afterEach(async () => {
  await enclave?.close()
  for (const dir of porLimpar.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe("entregar num canal daqui, com a federação LIGADA", () => {
  /**
   * The positive control, and it is not decoration: without it, the tests below
   * passed the same way if `receive` were broken and refused everyone. Proving a
   * door closes requires proving first that it opens.
   */
  it("um par a sério entrega, e fica inscrito no canal", async () => {
    await montar([PAR])
    expect(await entregar(envelopeDe(PAR))).toBe(200)

    const { eventos, pares } = rasto()
    expect(eventos).toBe(1)
    expect(pares).toEqual([PAR])
  })

  /**
   * The flaw in its exact form: the signature checks out, and that is not what
   * decides.
   *
   * The stranger signs with their own key, over their own name, and their
   * directory would confirm it. Everything lines up except the only thing that
   * matters, they are not a peer.
   */
  it("um servidor fora da allowlist não entrega, e não fica inscrito no canal", async () => {
    await montar([PAR])
    expect(await entregar(envelopeDe(ESTRANHO))).toBe(403)

    const { eventos, pares } = rasto()
    expect(eventos).toBe(0)
    // What hurts most if this fails: an accepted delivery enrolled them as a peer
    // of the channel, and all future traffic went to them next.
    expect(pares).toEqual([])
  })

  /** Announcing yourself is not the same as entering: a server is not a peer of itself. */
  it("um envelope que se diz vindo deste mesmo servidor é recusado", async () => {
    await montar([PAR, NOS])
    const nosso = loadOrCreateServerKey(dataDir)
    expect(await entregar(envelopeDe(NOS, nosso))).toBe(403)

    const { eventos, pares } = rasto()
    expect(eventos).toBe(0)
    expect(pares).toEqual([])
  })
})

describe("entregar num canal daqui, com a federação DESLIGADA", () => {
  /**
   * An empty allowlist means federation is OFF, not open to everyone.
   * It used to mean the opposite, which is why it is written in a test.
   */
  it("uma allowlist vazia recusa até um envelope perfeitamente assinado", async () => {
    await montar([])
    expect(await entregar(envelopeDe(PAR))).toBe(403)

    const { eventos, pares } = rasto()
    expect(eventos).toBe(0)
    expect(pares).toEqual([])
  })
})

describe("entregar um commit atrasado, com a federação LIGADA", () => {
  /**
   * The rule of one commit per epoch is not just the gateway's. A peer delivers
   * via `receive`, which writes and broadcasts through the same `appendEvent`,    * and if the rule lived in the gateway, a late commit from outside would break
   * the group through the side door, exactly as commits from inside used to.
   */
  it("o segundo commit para a mesma epoch não fica guardado", async () => {
    await montar([PAR])
    // From epoch 1, not 0, so the test does not depend on refounding (which
    // federation never grants, see `Federation.receive`).
    const fundacao = await rotateEpoch(await createChannel(generateIdentity(NOS), CANAL))
    const primeiro = (await rotateEpoch(fundacao.session)).commits[0] as Uint8Array
    const segundo = (await rotateEpoch(fundacao.session)).commits[0] as Uint8Array
    const chave = servidorRemoto()
    const corpoDe = (commit: Uint8Array): FederationBody => ({ channel: CANAL, kind: "handshake", ciphertext: toBase64(commit) })

    expect(await entregar(envelopeDe(PAR, chave, corpoDe(fundacao.commits[0] as Uint8Array)))).toBe(200)
    expect(await entregar(envelopeDe(PAR, chave, corpoDe(primeiro)))).toBe(200)
    expect(await entregar(envelopeDe(PAR, chave, corpoDe(segundo)))).toBe(403)
    expect(rasto().eventos).toBe(2)
    expect(enclave.store.epochDoCanal(CANAL)).toBe(2)
  }, 30_000)

  it("um commit com destinatário vindo de um par não se guarda", async () => {
    await montar([PAR])
    const fundacao = await rotateEpoch(await createChannel(generateIdentity(NOS), CANAL))
    const corpo: FederationBody = {
      channel: CANAL,
      kind: "handshake",
      ciphertext: toBase64(fundacao.commits[0] as Uint8Array),
      recipient: generateIdentity(NOS).address,
    }
    expect(await entregar(envelopeDe(PAR, servidorRemoto(), corpo))).toBe(403)
    expect(enclave.store.epochDoCanal(CANAL)).toBeUndefined()
  }, 30_000)

  it("o mesmo commit entregue outra vez é aceite sem se guardar de novo, e o par deixa de insistir", async () => {
    // Delivery is at least once: a peer whose response was lost sends again.
    // With 403, it retried twelve times for a commit already here.
    await montar([PAR])
    const fundacao = await rotateEpoch(await createChannel(generateIdentity(NOS), CANAL))
    const chave = servidorRemoto()
    const corpo: FederationBody = { channel: CANAL, kind: "handshake", ciphertext: toBase64(fundacao.commits[0] as Uint8Array) }

    expect(await entregar(envelopeDe(PAR, chave, corpo))).toBe(200)
    expect(await entregar(envelopeDe(PAR, chave, corpo))).toBe(200)
    expect(rasto().eventos).toBe(1)
    expect(enclave.store.epochDoCanal(CANAL)).toBe(1)
  }, 30_000)
})
