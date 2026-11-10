import { ed25519 } from "@noble/curves/ed25519.js"
import { describe, expect, it } from "vitest"
import { PeerClaim, PeerClaimReply, signPeerClaim, verifyPeerClaim } from "./federation.js"
import { APARELHOS_POR_CONTA } from "./identity.js"
import { parseServerName } from "./ids.js"
import { ClientFrame, ServerFrame } from "./wire.js"

/**
 * The claim bundled in the wire: new fields are OPTIONAL, and their absence
 * must continue to mean what it already meant (a packet, nothing else).
 *
 * House rule comes from `wire.video.test.ts`: a `z.object` without the field
 * does not REJECT it, silently strips it. This is how a new client downgrades
 * to a packet against a 0.2.3 server, and this is what these tests assert
 * both ways: the new field passes when present, and the old form passes when
 * absent.
 */
const CHAVE = "A".repeat(43)
const PACOTE = "cGFjb3Rl"

describe("keypackage.claim", () => {
  it("sem `bundle` é `false`, que é o pedido de um cliente 0.2.3", () => {
    const frame = ClientFrame.parse({ t: "keypackage.claim", address: "@ana:localhost" })
    expect(frame.t === "keypackage.claim" && frame.bundle).toBe(false)
    expect("devices" in frame).toBe(false)
  })

  it("com `bundle: true` e `devices`, ENTREGA-OS", () => {
    const frame = ClientFrame.parse({ t: "keypackage.claim", address: "@ana:localhost", bundle: true, devices: [CHAVE] })
    expect(frame.t === "keypackage.claim" && frame.bundle).toBe(true)
    expect(frame.t === "keypackage.claim" && frame.devices).toStrictEqual([CHAVE])
  })

  it("`devices` não leva mais aparelhos do que uma conta pode ter", () => {
    const aMais = Array.from({ length: APARELHOS_POR_CONTA + 1 }, () => CHAVE)
    expect(ClientFrame.safeParse({ t: "keypackage.claim", address: "@ana:localhost", bundle: true, devices: aMais }).success).toBe(false)
  })
})

describe("keypackage.publish", () => {
  it("continua a ler a forma sem `device`, que é a de um cliente 0.2.3", () => {
    const frame = ClientFrame.parse({ t: "keypackage.publish", packages: [PACOTE] })
    expect("device" in frame).toBe(false)
  })

  it("entrega o `device` quando vem", () => {
    const frame = ClientFrame.parse({ t: "keypackage.publish", packages: [PACOTE], device: CHAVE })
    expect(frame.t === "keypackage.publish" && frame.device).toBe(CHAVE)
  })
})

describe("keypackage.claimed", () => {
  it("a forma de sempre, só com o singular, continua a passar", () => {
    const frame = ServerFrame.parse({ t: "keypackage.claimed", address: "@ana:localhost", keyPackage: null })
    expect("keyPackages" in frame).toBe(false)
    expect("manifest" in frame).toBe(false)
  })

  it("um bundle com mais pacotes do que aparelhos numa conta é recusado pela forma", () => {
    const aMais = Array.from({ length: APARELHOS_POR_CONTA + 1 }, () => ({ deviceKey: CHAVE, keyPackage: PACOTE }))
    expect(ServerFrame.safeParse({ t: "keypackage.claimed", address: "@ana:localhost", keyPackage: PACOTE, keyPackages: aMais }).success).toBe(false)
    const noTecto = Array.from({ length: APARELHOS_POR_CONTA }, () => ({ deviceKey: CHAVE, keyPackage: PACOTE }))
    expect(ServerFrame.safeParse({ t: "keypackage.claimed", address: "@ana:localhost", keyPackage: PACOTE, keyPackages: noTecto }).success).toBe(true)
  })

  it("entrega o bundle e o manifesto quando vêm, e `manifest: null` é ler-se como veio", () => {
    const frame = ServerFrame.parse({
      t: "keypackage.claimed",
      address: "@ana:localhost",
      keyPackage: PACOTE,
      keyPackages: [{ deviceKey: CHAVE, keyPackage: PACOTE }],
      manifest: null,
    })
    expect(frame.t === "keypackage.claimed" && frame.keyPackages).toStrictEqual([{ deviceKey: CHAVE, keyPackage: PACOTE }])
    expect(frame.t === "keypackage.claimed" && frame.manifest).toBeNull()
  })
})

describe("o pedido federado", () => {
  const NOS = parseServerName("casa.example")
  const PAR = parseServerName("par.example")
  const privada = ed25519.utils.randomSecretKey()
  const publica = ed25519.getPublicKey(privada)
  const opcoes = {
    destination: PAR,
    resolveKey: () => publica,
    spendNonce: () => true,
    nowSeconds: 1_700_000_000,
  }
  const campos = { origin: NOS, destination: PAR, issuedAt: 1_700_000_000, nonce: "bm9uY2UtZGUtdGVzdGUtMQ", address: "@ana:par.example" }

  it("`bundle` e `devices` viajam FORA da assinatura: um par que os ignore continua a verificar", () => {
    const claim = signPeerClaim({ keyId: "k1", privateKey: privada }, campos, { bundle: true, devices: [CHAVE] })
    expect(claim.bundle).toBe(true)
    expect(claim.devices).toStrictEqual([CHAVE])
    // The check is the usual one, over the five fields: the two new ones do not
    // enter it, otherwise a 0.2.3 pair would reject the entire request.
    expect(verifyPeerClaim(claim, opcoes).ok).toBe(true)
    const { bundle: _b, devices: _d, ...semEles } = claim
    expect(verifyPeerClaim(PeerClaim.parse(semEles), opcoes).ok).toBe(true)
  })

  it("e na direcção que importa: um claim simples assinado, com `bundle` ACRESCENTADO depois, continua a verificar", () => {
    // This is what a new server does to an old peer, and this is what would have
    // failed if the fields entered the signed canonical form.
    const simples = signPeerClaim({ keyId: "k1", privateKey: privada }, campos)
    const comBundle = PeerClaim.parse({ ...simples, bundle: true, devices: [CHAVE] })
    expect(comBundle.bundle).toBe(true)
    expect(verifyPeerClaim(comBundle, opcoes).ok).toBe(true)
    // As long as changing a signed field breaks the signature.
    expect(verifyPeerClaim({ ...comBundle, address: "@outra:par.example" }, opcoes)).toStrictEqual({ ok: false, reason: "bad-signature" })
  })

  it("`devices` no pedido federado não leva mais do que uma conta pode ter", () => {
    const simples = signPeerClaim({ keyId: "k1", privateKey: privada }, campos)
    expect(PeerClaim.safeParse({ ...simples, bundle: true, devices: Array.from({ length: APARELHOS_POR_CONTA }, () => CHAVE) }).success).toBe(true)
    expect(PeerClaim.safeParse({ ...simples, bundle: true, devices: Array.from({ length: APARELHOS_POR_CONTA + 1 }, () => CHAVE) }).success).toBe(false)
  })

  it("sem os campos novos, o pedido é byte a byte o de antes", () => {
    const claim = signPeerClaim({ keyId: "k1", privateKey: privada }, campos)
    expect("bundle" in claim).toBe(false)
    expect("devices" in claim).toBe(false)
  })

  it("a resposta de um par 0.2.3, só com `keyPackage`, passa no molde, e um bundle acima do tecto não", () => {
    expect(PeerClaimReply.parse({ keyPackage: null })).toStrictEqual({ keyPackage: null })
    const cheia = PeerClaimReply.parse({ keyPackage: PACOTE, keyPackages: [{ deviceKey: CHAVE, keyPackage: PACOTE }], manifest: null })
    expect(cheia.keyPackages).toHaveLength(1)
    const aMais = Array.from({ length: APARELHOS_POR_CONTA + 1 }, () => ({ deviceKey: CHAVE, keyPackage: PACOTE }))
    expect(PeerClaimReply.safeParse({ keyPackage: PACOTE, keyPackages: aMais }).success).toBe(false)
  })
})
