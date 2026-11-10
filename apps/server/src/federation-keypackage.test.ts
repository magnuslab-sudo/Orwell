import {
  FEDERATION_PATH,
  generateIdentity,
  parseServerName,
  signDeviceManifest,
  signPeerClaim,
  toBase64,
  type PeerClaim,
  type PeerClaimReply,
  type ServerName,
} from "@enclave/protocol"
import { ed25519 } from "@noble/curves/ed25519.js"
import { sha256 } from "@noble/hashes/sha2.js"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { buildServer, type Enclave } from "./app.js"
import { loadOrCreateServerKey, type ServerConfig } from "./config.js"
import { currentSecond } from "./db.js"

/**
 * The route that serves key packages to a peer, and that SPENDS them as it
 * serves them.
 *
 * It decided by headers: an `Origin`, or an `X-Enclave-Server`, compared
 * against the allowlist. Neither proves anything (the caller picks them), so
 * anyone who knew the name of a peer on the allowlist could drain the pool of
 * any account here with a `curl` loop, and the victim only saw invites that
 * never arrived. The production server has its OWN name on the allowlist, so it was
 * enough to claim to be it: this was not a latent flaw waiting for someone to
 * turn federation on, it was an open door.
 *
 * It was latent in another sense, a real one: federation never ran between two
 * servers for real, and that is why the route could change form (GET with
 * headers → POST with a signed request) without breaking anyone.
 */

const NOS = parseServerName("casa.example")
const PAR = parseServerName("par.example")
const ESTRANHO = parseServerName("estranho.example")

let enclave: Enclave
let dataDir: string
let parKeyDir: string
let par: ReturnType<typeof loadOrCreateServerKey>
let conta: ReturnType<typeof generateIdentity>

async function montar(allowlist: string[]): Promise<void> {
  dataDir = mkdtempSync(join(tmpdir(), "enclave-fed-"))
  parKeyDir = mkdtempSync(join(tmpdir(), "enclave-par-"))
  par = loadOrCreateServerKey(parKeyDir)

  const config: ServerConfig = {
    serverName: NOS,
    bindHost: "127.0.0.1",
    bindPort: 0,
    dataDir,
    databasePath: join(dataDir, "test.sqlite"),
    sfuPort: 0,
    sfuAnnouncedIp: "",
    retentionDays: 30,
    allowlist: allowlist.map(parseServerName),
    turnUrls: [],
    turnSecret: "",
    turnTtl: 600,
    communityMode: false,
    commonRoom: "",
  }
  enclave = await buildServer(config)

  // The peer's key, already cached: without this the server would fetch it from
  // its directory over HTTPS, and a test does not talk to the network. It is
  // the same cache that `#ensurePeerKey` fills in real life.
  enclave.store.cachePeerKey(PAR, par.keyId, par.publicKey, currentSecond() + 3600)

  // A local account with published key packages: the pool that the route spends.
  conta = generateIdentity(NOS)
  enclave.store.registerOrVerifyAccount(conta.address, conta.signingPublicKey)
  enclave.store.publishKeyPackages(
    conta.address,
    Array.from({ length: 5 }, (_, i) => new Uint8Array([i, i, i])),
    false,
  )
}

/**
 * A SIGNED request over the fields given to it.
 *
 * The fields go in before signing on purpose. Swapping them afterwards (the
 * first version of this did) makes everything fail with `bad-signature`, and a
 * test meant to measure the clock or the allowlist passes without reaching
 * them. Caught by mutation: with the clock check off, the old-request test
 * stayed green.
 */
function pedido(
  campos: Partial<{ origin: ServerName; destination: ServerName; issuedAt: number; address: string }> = {},
  chave = par,
  keyId?: string,
): PeerClaim {
  const claim = signPeerClaim(
    { keyId: keyId ?? chave.keyId, privateKey: chave.privateKey },
    {
      origin: campos.origin ?? PAR,
      destination: campos.destination ?? NOS,
      issuedAt: campos.issuedAt ?? currentSecond(),
      nonce: toBase64(crypto.getRandomValues(new Uint8Array(16))),
      address: campos.address ?? conta.address,
    },
  )
  return claim
}

async function pedir(claim: unknown): Promise<{ estado: number; keyPackage: string | null }> {
  const resposta = await enclave.app.inject({
    method: "POST",
    url: `${FEDERATION_PATH}/keypackage`,
    payload: claim as Record<string, unknown>,
  })
  const corpo = resposta.json<{ keyPackage?: string | null }>()
  return { estado: resposta.statusCode, keyPackage: corpo.keyPackage ?? null }
}

afterEach(async () => {
  await enclave?.close()
  rmSync(dataDir, { recursive: true, force: true })
  rmSync(parKeyDir, { recursive: true, force: true })
})

describe("key packages para um par, com a federação LIGADA", () => {
  beforeEach(async () => {
    await montar([PAR])
  })

  it("um par a sério, com o pedido assinado, é servido", async () => {
    const antes = enclave.store.availableKeyPackages(conta.address)
    const { estado, keyPackage } = await pedir(pedido())
    expect(estado).toBe(200)
    expect(keyPackage).not.toBeNull()
    // Serving SPENDS: that is why the route needs proof.
    expect(enclave.store.availableKeyPackages(conta.address)).toBe(antes - 1)
  })

  /**
   * The flaw, in its exact form: claiming to be the peer without having its key.
   *
   * The request names the allowlisted peer in every field, even the `keyId`
   * (the identifier of the key the peer publishes in its directory, which this
   * server has cached). Only the signature comes from a different key. Without
   * that detail, the request would be refused with `unknown-key` and the test
   * would pass without measuring the signature: verified by mutation, pretending
   * the signature always checks out.
   *
   * This is exactly what the headers let through, and they no longer exist:
   * there is no `Origin` here to make up.
   */
  it("quem se diz o par sem ter a chave dele não é servido, e não gasta nada", async () => {
    const impostorDir = mkdtempSync(join(tmpdir(), "enclave-impostor-"))
    const impostor = loadOrCreateServerKey(impostorDir)
    const antes = enclave.store.availableKeyPackages(conta.address)

    const { estado, keyPackage } = await pedir(pedido({}, impostor, par.keyId))

    expect(estado).toBe(403)
    expect(keyPackage).toBeNull()
    expect(enclave.store.availableKeyPackages(conta.address)).toBe(antes)
    rmSync(impostorDir, { recursive: true, force: true })
  })

  /**
   * The same, by another route: the good request with the address swapped.
   *
   * A signature is worth what it signs. If the address did not go into the
   * signed bytes, any captured legitimate request could drain the pool of
   * any other account: rewriting one line of the JSON was enough.
   */
  it("mexer no endereço depois de assinado invalida o pedido", async () => {
    const outra = generateIdentity(NOS)
    enclave.store.registerOrVerifyAccount(outra.address, outra.signingPublicKey)
    enclave.store.publishKeyPackages(outra.address, [new Uint8Array([9, 9, 9])], false)

    // Signed for the first account, rewritten for the second.
    const { estado } = await pedir({ ...pedido(), address: outra.address })

    expect(estado).toBe(403)
    expect(enclave.store.availableKeyPackages(outra.address)).toBe(1)
  })

  /**
   * A malformed body gets a 403, not a 400 that would set it apart.
   *
   * The name of this test used to be "a request without any signature is
   * refused", and it was lying by omission: a `signature: undefined` never
   * reaches the verifier: it dies in zod's `safeParse`. Verified by mutation,
   * pretending the signature always checks out: the test stayed green, so it
   * measured no signature at all. Anyone reading it would think that guard was
   * covered, and that is how a check dies without anyone noticing.
   *
   * What it really measures (and it does) is that the response is ALWAYS the
   * same. With a 400 for the malformed body and a 403 for the rest, the route
   * would tell "I did not understand what you sent" apart from "I will not
   * serve you": the first step toward an oracle. Mutate the code to 400 and
   * this test fails.
   *
   * The signature itself is measured in the impostor test above.
   */
  it("um corpo malformado responde o mesmo 403 que uma recusa, sem se distinguir", async () => {
    const antes = enclave.store.availableKeyPackages(conta.address)
    const { estado } = await pedir({ ...pedido(), signature: undefined })
    expect(estado).toBe(403)
    expect(enclave.store.availableKeyPackages(conta.address)).toBe(antes)
  })

  /**
   * The case production has today: the allowlist with OUR own name.
   *
   * `#allowed` refuses to federate with itself, and that is what stops a request
   * signed by us (or by anyone claiming to be us) from serving itself. With
   * the decision in the headers, `Origin: https://orwell.pt` would match the
   * production allowlist and pass.
   */
  it("o nosso próprio nome na allowlist não abre a porta a quem se diz nós", async () => {
    // Our own key, and our own name: the request checks out cryptographically
    // and is refused anyway, because a server is not its own peer.
    // It is the same guard `#allowed` already applied on delivery.
    const nosso = loadOrCreateServerKey(dataDir)
    enclave.store.cachePeerKey(NOS, nosso.keyId, nosso.publicKey, currentSecond() + 3600)
    const antes = enclave.store.availableKeyPackages(conta.address)

    const { estado } = await pedir(pedido({ origin: NOS }, nosso))

    expect(estado).toBe(403)
    expect(enclave.store.availableKeyPackages(conta.address)).toBe(antes)
  })

  it("um pedido de um servidor fora da allowlist é recusado", async () => {
    const outroDir = mkdtempSync(join(tmpdir(), "enclave-outro-"))
    const outro = loadOrCreateServerKey(outroDir)
    enclave.store.cachePeerKey(ESTRANHO, outro.keyId, outro.publicKey, currentSecond() + 3600)

    expect((await pedir(pedido({ origin: ESTRANHO }, outro))).estado).toBe(403)
    rmSync(outroDir, { recursive: true, force: true })
  })

  /** Capturing a good request and replaying it does not work twice. */
  it("repetir o mesmo pedido não gasta um segundo key package", async () => {
    const claim = pedido()
    expect((await pedir(claim)).estado).toBe(200)
    const depoisDoPrimeiro = enclave.store.availableKeyPackages(conta.address)

    expect((await pedir(claim)).estado).toBe(403)
    expect(enclave.store.availableKeyPackages(conta.address)).toBe(depoisDoPrimeiro)
  })

  /** A request signed for another server does not get forwarded to this one. */
  it("um pedido dirigido a outro servidor não serve aqui", async () => {
    expect((await pedir(pedido({ destination: ESTRANHO }))).estado).toBe(403)
  })

  /** Nor does a request saved from yesterday. */
  it("um pedido velho é recusado", async () => {
    expect((await pedir(pedido({ issuedAt: currentSecond() - 3600 }))).estado).toBe(403)
  })

  /**
   * The old door, sealed.
   *
   * While GET exists, nothing above matters: you could just call it again with
   * the usual headers.
   */
  it("a rota antiga, decidida por cabeçalhos, já não existe", async () => {
    const resposta = await enclave.app.inject({
      method: "GET",
      url: `${FEDERATION_PATH}/keypackage/${encodeURIComponent(conta.address)}`,
      headers: { origin: `https://${PAR}`, "x-enclave-server": PAR },
    })
    expect(resposta.statusCode).toBe(404)
    expect(enclave.store.availableKeyPackages(conta.address)).toBe(5)
  })
})

describe("key packages para um par, com a federação DESLIGADA", () => {
  beforeEach(async () => {
    await montar([])
  })

  it("uma allowlist vazia recusa até um pedido perfeitamente assinado", async () => {
    expect((await pedir(pedido())).estado).toBe(403)
    expect(enclave.store.availableKeyPackages(conta.address)).toBe(5)
  })
})

/**
 * The bundle crosses federation with the same contract as the gateway: requested,
 * never offered. A peer on 0.2.3 sends the usual request and gets the usual
 * response; a peer that asks for `bundle` gets one key package per device and the
 * manifest, which goes to the client on its side to verify.
 */
describe("key packages em bundle para um par", () => {
  const A = ed25519.getPublicKey(sha256(Uint8Array.from([1])))
  const B = ed25519.getPublicKey(sha256(Uint8Array.from([2])))

  beforeEach(async () => {
    await montar([PAR])
    // The account now has two devices with a pool, and the manifest with both.
    // The device-less pool from `montar` stays there (five NULL rows).
    enclave.store.publishKeyPackages(conta.address, [new Uint8Array([10]), new Uint8Array([11])], false, A)
    enclave.store.publishKeyPackages(conta.address, [new Uint8Array([20])], false, B)
    const agora = currentSecond()
    expect(
      enclave.store.putDeviceManifest(
        signDeviceManifest(conta.signingPrivateKey, {
          address: conta.address,
          version: 1,
          devices: [
            { deviceKey: A, addedAt: agora },
            { deviceKey: B, addedAt: agora },
          ],
          signedAt: agora,
        }),
      ).ok,
    ).toBe(true)
  })

  async function pedirCompleto(claim: unknown): Promise<{ estado: number; corpo: PeerClaimReply }> {
    const resposta = await enclave.app.inject({ method: "POST", url: `${FEDERATION_PATH}/keypackage`, payload: claim as Record<string, unknown> })
    return { estado: resposta.statusCode, corpo: resposta.json<PeerClaimReply>() }
  }

  it("sem `bundle`, a resposta é só o singular, e gasta UM", async () => {
    const antes = enclave.store.availableKeyPackages(conta.address)
    const { estado, corpo } = await pedirCompleto(pedido())
    expect(estado).toBe(200)
    expect(corpo.keyPackage).not.toBeNull()
    expect("keyPackages" in corpo).toBe(false)
    expect("manifest" in corpo).toBe(false)
    expect(enclave.store.availableKeyPackages(conta.address)).toBe(antes - 1)
  })

  it("com `bundle`, um pacote por aparelho do manifesto e o manifesto, e a assinatura continua a fechar", async () => {
    const claim = signPeerClaim(
      { keyId: par.keyId, privateKey: par.privateKey },
      { origin: PAR, destination: NOS, issuedAt: currentSecond(), nonce: toBase64(crypto.getRandomValues(new Uint8Array(16))), address: conta.address },
      { bundle: true },
    )
    const { estado, corpo } = await pedirCompleto(claim)
    expect(estado).toBe(200)
    expect(corpo.keyPackages?.map((p) => p.deviceKey).sort()).toEqual([toBase64(A), toBase64(B)].sort())
    expect(corpo.manifest?.version).toBe(1)
    expect(corpo.keyPackage).toBe(corpo.keyPackages?.[0]?.keyPackage)
    expect(enclave.store.availableKeyPackages(conta.address, A)).toBe(5 + 1)
    expect(enclave.store.availableKeyPackages(conta.address, B)).toBe(5 + 0)
  })

  it("um claim em bundle repetido (mesmo nonce) é recusado, e não gasta mais nada", async () => {
    const claim = signPeerClaim(
      { keyId: par.keyId, privateKey: par.privateKey },
      { origin: PAR, destination: NOS, issuedAt: currentSecond(), nonce: toBase64(crypto.getRandomValues(new Uint8Array(16))), address: conta.address },
      { bundle: true },
    )
    const primeira = await pedirCompleto(claim)
    expect(primeira.estado).toBe(200)
    expect(primeira.corpo.keyPackages).toHaveLength(2)
    const depois = enclave.store.availableKeyPackages(conta.address)

    const segunda = await pedirCompleto(claim)
    expect(segunda.estado).toBe(403)
    expect(enclave.store.availableKeyPackages(conta.address)).toBe(depois)
    // And the same request with `bundle` added AFTER signing (different nonce,
    // same signature) still verifies: the new fields stay out of the signature,
    // on purpose.
    const semBundle = signPeerClaim(
      { keyId: par.keyId, privateKey: par.privateKey },
      { origin: PAR, destination: NOS, issuedAt: currentSecond(), nonce: toBase64(crypto.getRandomValues(new Uint8Array(16))), address: conta.address },
    )
    const terceira = await pedirCompleto({ ...semBundle, bundle: true, devices: [toBase64(A)] })
    expect(terceira.estado).toBe(200)
    expect(terceira.corpo.keyPackages?.map((p) => p.deviceKey)).toStrictEqual([toBase64(A)])
  })

  it("com `devices`, só os pedidos", async () => {
    const claim = signPeerClaim(
      { keyId: par.keyId, privateKey: par.privateKey },
      { origin: PAR, destination: NOS, issuedAt: currentSecond(), nonce: toBase64(crypto.getRandomValues(new Uint8Array(16))), address: conta.address },
      { bundle: true, devices: [toBase64(B)] },
    )
    const { corpo } = await pedirCompleto(claim)
    expect(corpo.keyPackages?.map((p) => p.deviceKey)).toEqual([toBase64(B)])
    expect(enclave.store.availableKeyPackages(conta.address, A)).toBe(5 + 2)
  })
})
