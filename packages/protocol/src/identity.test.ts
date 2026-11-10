import { ed25519 } from "@noble/curves/ed25519.js"
import { sha256 } from "@noble/hashes/sha2.js"
import { describe, expect, it } from "vitest"
import { accountIdFromSigningKey, makeUserAddress, parseServerName, type UserAddress } from "./ids.js"
import {
  CREDENTIAL_VERSION,
  decodeDeviceCredential,
  deviceRevocationMessage,
  encodeDeviceCredential,
  generateIdentity,
  identityFromDeviceCert,
  identityFromPrivateKey,
  sign,
  signDeviceCert,
  signDeviceRevocation,
  signWithDevice,
  temChaveDeConta,
  verifyDeviceChain,
  verifyDeviceRevocation,
  type DeviceCredential,
} from "./identity.js"

/**
 * The credential that travels in the MLS leaf, back and forth.
 *
 * Two demands that are not a matter of taste:
 *
 * **Determinism.** This is compared byte for byte, by MLS, when it verifies that
 * an updated leaf still belongs to the same person, and by us, when we compare
 * what the tree says with what the vault stored. Two writes of the same fact
 * that produced different bytes would be two identities.
 *
 * **Refusal without exception.** `decodeDeviceCredential` returns `undefined` to
 * anything that is not exactly our credential, and `verifyDeviceChain` returns
 * `false`. Whoever calls them is deciding whether to admit a leaf; the promised
 * refusal is silence, and an exception there would be a different failure than
 * the one promised, bubbling up a path that does not always catch it.
 */

const SERVIDOR = parseServerName("orwell.pt")

function contaDeTeste(semente: number) {
  const privada = sha256(Uint8Array.from([semente & 0xff, (semente >>> 8) & 0xff]))
  const publica = ed25519.getPublicKey(privada)
  return { privada, publica, endereco: makeUserAddress(accountIdFromSigningKey(publica), SERVIDOR) }
}

function credencialDeTeste(semente = 1): DeviceCredential {
  const conta = contaDeTeste(semente)
  const aparelho = ed25519.getPublicKey(sha256(Uint8Array.from([semente, 0xaa])))
  return {
    address: conta.endereco,
    accountKey: conta.publica,
    deviceKey: aparelho,
    signature: signDeviceCert(conta.privada, aparelho, conta.endereco),
  }
}

describe("credencial de aparelho", () => {
  it("faz a ida e volta inteira, campo a campo", () => {
    const original = credencialDeTeste()
    const lida = decodeDeviceCredential(encodeDeviceCredential(original))

    expect(lida).toBeDefined()
    expect(lida?.address).toBe(original.address)
    expect(lida?.accountKey).toEqual(original.accountKey)
    expect(lida?.deviceKey).toEqual(original.deviceKey)
    expect(lida?.signature).toEqual(original.signature)
    expect(verifyDeviceChain(lida as DeviceCredential)).toBe(true)
  })

  it("codifica sempre os mesmos bytes para a mesma credencial", () => {
    const credencial = credencialDeTeste()
    expect(encodeDeviceCredential(credencial)).toEqual(encodeDeviceCredential(credencial))
    // And the round trip too: decode and encode again cannot touch a byte, or
    // the same leaf would end up with two different writes.
    const bytes = encodeDeviceCredential(credencial)
    expect(encodeDeviceCredential(decodeDeviceCredential(bytes) as DeviceCredential)).toEqual(bytes)
  })

  it("marca a versão do formato, para a v1 nunca poder ser lida como v2", () => {
    const bytes = encodeDeviceCredential(credencialDeTeste())
    expect(bytes[4]).toBe(CREDENTIAL_VERSION)

    const outraVersao = Uint8Array.from(bytes)
    outraVersao[4] = 1
    expect(decodeDeviceCredential(outraVersao)).toBeUndefined()
  })

  it("recusa a credencial da v1 — o endereço em texto — sem lançar", () => {
    const v1 = new TextEncoder().encode(contaDeTeste(2).endereco)
    expect(decodeDeviceCredential(v1)).toBeUndefined()
  })

  it("recusa qualquer prefixo, qualquer sufixo e o vazio, sem lançar", () => {
    const bytes = encodeDeviceCredential(credencialDeTeste(3))

    expect(decodeDeviceCredential(new Uint8Array(0))).toBeUndefined()
    for (let corte = 0; corte < bytes.length; corte++) {
      expect(decodeDeviceCredential(bytes.subarray(0, corte))).toBeUndefined()
    }

    const comLixo = new Uint8Array(bytes.length + 1)
    comLixo.set(bytes, 0)
    expect(decodeDeviceCredential(comLixo)).toBeUndefined()
  })

  it("recusa um endereço que não seja UTF-8 válido", () => {
    const conta = contaDeTeste(4)
    const aparelho = ed25519.getPublicKey(sha256(Uint8Array.from([4, 0xbb])))
    const bytes = encodeDeviceCredential({
      address: conta.endereco,
      accountKey: conta.publica,
      deviceKey: aparelho,
      signature: signDeviceCert(conta.privada, aparelho, conta.endereco),
    })

    // A lone byte from a multibyte sequence, in the middle of the address.
    const torto = Uint8Array.from(bytes)
    torto[torto.length - 1] = 0xc3
    expect(decodeDeviceCredential(torto)).toBeUndefined()
  })

  it("recusa escrever uma credencial com uma chave do tamanho errado", () => {
    const credencial = credencialDeTeste(5)
    // Here it THROWS on purpose, and that is the right asymmetry: whoever writes
    // is producing their own credential and their error has to hurt where someone
    // sees it; whoever reads is judging another's bytes and cannot go below for
    // that. It is the same rule as `encodePayload` against `decodePayload`.
    expect(() => encodeDeviceCredential({ ...credencial, accountKey: new Uint8Array(31) })).toThrow()
    expect(() => encodeDeviceCredential({ ...credencial, deviceKey: new Uint8Array(33) })).toThrow()
    expect(() => encodeDeviceCredential({ ...credencial, signature: new Uint8Array(63) })).toThrow()
  })
})

describe("verifyDeviceChain", () => {
  it("recusa o endereço que não é o resumo da chave de conta", () => {
    const minha = contaDeTeste(6)
    const alheia = contaDeTeste(7)
    const aparelho = ed25519.getPublicKey(sha256(Uint8Array.from([6, 0xcc])))

    expect(
      verifyDeviceChain({
        address: alheia.endereco,
        accountKey: minha.publica,
        deviceKey: aparelho,
        signature: signDeviceCert(minha.privada, aparelho, alheia.endereco),
      }),
    ).toBe(false)
  })

  it("recusa o certificado assinado por outra conta", () => {
    const ana = contaDeTeste(8)
    const eva = contaDeTeste(9)
    const aparelho = ed25519.getPublicKey(sha256(Uint8Array.from([8, 0xdd])))

    expect(
      verifyDeviceChain({
        address: ana.endereco,
        accountKey: ana.publica,
        deviceKey: aparelho,
        signature: signDeviceCert(eva.privada, aparelho, ana.endereco),
      }),
    ).toBe(false)
  })

  it("recusa o certificado emitido para outro aparelho", () => {
    const ana = contaDeTeste(10)
    const certificado = ed25519.getPublicKey(sha256(Uint8Array.from([10, 0xee])))
    const outro = ed25519.getPublicKey(sha256(Uint8Array.from([10, 0xef])))

    expect(
      verifyDeviceChain({
        address: ana.endereco,
        accountKey: ana.publica,
        deviceKey: outro,
        signature: signDeviceCert(ana.privada, certificado, ana.endereco),
      }),
    ).toBe(false)
  })

  /**
   * The certificate is bound to the server because the address brings it
   * inside. Without that, the same device would present itself to another
   * server with the certificate they gave it here.
   */
  it("recusa o certificado de outro servidor, ainda que da mesma conta", () => {
    const ana = contaDeTeste(11)
    const aparelho = ed25519.getPublicKey(sha256(Uint8Array.from([11, 0xf0])))
    const noutroServidor = makeUserAddress(accountIdFromSigningKey(ana.publica), parseServerName("outro.example"))

    expect(
      verifyDeviceChain({
        address: noutroServidor,
        accountKey: ana.publica,
        deviceKey: aparelho,
        signature: signDeviceCert(ana.privada, aparelho, ana.endereco),
      }),
    ).toBe(false)
  })

  it("recusa endereços que não são endereços, e chaves com o tamanho errado, sem lançar", () => {
    const ana = contaDeTeste(12)
    const aparelho = ed25519.getPublicKey(sha256(Uint8Array.from([12, 0xf1])))
    const assinatura = signDeviceCert(ana.privada, aparelho, ana.endereco)
    const boa = { address: ana.endereco, accountKey: ana.publica, deviceKey: aparelho, signature: assinatura }

    expect(verifyDeviceChain({ ...boa, address: "isto não é um endereço" })).toBe(false)
    expect(verifyDeviceChain({ ...boa, address: "" })).toBe(false)
    expect(verifyDeviceChain({ ...boa, accountKey: new Uint8Array(0) })).toBe(false)
    expect(verifyDeviceChain({ ...boa, deviceKey: new Uint8Array(1) })).toBe(false)
    expect(verifyDeviceChain({ ...boa, signature: new Uint8Array(10) })).toBe(false)
  })

  it("recusa a credencial de um espaço, que nunca assina nada", () => {
    const ana = contaDeTeste(13)
    const aparelho = ed25519.getPublicKey(sha256(Uint8Array.from([13, 0xf2])))
    const espaco = `!${accountIdFromSigningKey(ana.publica)}:${SERVIDOR}` as UserAddress

    expect(
      verifyDeviceChain({
        address: espaco,
        accountKey: ana.publica,
        deviceKey: aparelho,
        signature: signDeviceCert(ana.privada, aparelho, espaco),
      }),
    ).toBe(false)
  })
})

describe("identidade", () => {
  it("o endereço deriva da chave de CONTA e não da do aparelho", () => {
    const identidade = generateIdentity(SERVIDOR)

    expect(identidade.accountId).toBe(accountIdFromSigningKey(identidade.signingPublicKey))
    expect(identidade.accountId).not.toBe(accountIdFromSigningKey(identidade.deviceSigningPublicKey))
    expect(identidade.address).toBe(makeUserAddress(identidade.accountId, SERVIDOR))
  })

  it("as duas chaves nascem distintas", () => {
    const identidade = generateIdentity(SERVIDOR)
    expect(identidade.deviceSigningPublicKey).not.toEqual(identidade.signingPublicKey)
    expect(identidade.deviceSigningPrivateKey).not.toEqual(identidade.signingPrivateKey)
  })

  it("a credencial que a identidade carrega fecha a cadeia", () => {
    const identidade = generateIdentity(SERVIDOR)

    expect(verifyDeviceChain(identidade.credential)).toBe(true)
    expect(identidade.credential.address).toBe(identidade.address)
    expect(identidade.credential.accountKey).toEqual(identidade.signingPublicKey)
    expect(identidade.credential.deviceKey).toEqual(identidade.deviceSigningPublicKey)
  })

  /**
   * The device key has to survive a restart, and that is why it comes as a
   * parameter: MLS leaves already published are signed by it, and minting
   * another one on every startup would make the same account present itself
   * as a different device every time.
   */
  it("a mesma chave de aparelho guardada dá a mesma identidade", () => {
    const conta = contaDeTeste(14)
    const doAparelho = sha256(Uint8Array.from([14, 0xf3]))

    const primeira = identityFromPrivateKey(conta.privada, SERVIDOR, doAparelho)
    const segunda = identityFromPrivateKey(conta.privada, SERVIDOR, doAparelho)

    expect(segunda.address).toBe(primeira.address)
    expect(segunda.deviceSigningPublicKey).toEqual(primeira.deviceSigningPublicKey)
    // Determinism down to the credential's bytes: Ed25519 signs without randomness.
    expect(encodeDeviceCredential(segunda.credential)).toEqual(encodeDeviceCredential(primeira.credential))
  })

  it("sem chave de aparelho guardada, nasce uma nova e o endereço não muda", () => {
    const conta = contaDeTeste(15)

    const primeira = identityFromPrivateKey(conta.privada, SERVIDOR)
    const segunda = identityFromPrivateKey(conta.privada, SERVIDOR)

    expect(segunda.address).toBe(primeira.address)
    expect(segunda.deviceSigningPublicKey).not.toEqual(primeira.deviceSigningPublicKey)
  })
})

/**
 * The identity of a PAIRED device: certificate from outside, account private
 * key nowhere. This is the guard that makes the design decision in section 4
 * (docs/PLANO_MULTIDISPOSITIVO.md §10) verifiable instead of promised.
 */
describe("identidade por certificado (aparelho emparelhado)", () => {
  const conta = contaDeTeste(21)
  const pc = identityFromPrivateKey(conta.privada, SERVIDOR)
  const telemovelPrivada = ed25519.utils.randomSecretKey()
  const telemovelPublica = ed25519.getPublicKey(telemovelPrivada)
  const certificado = signDeviceCert(conta.privada, telemovelPublica, pc.address)

  it("monta a identidade sem a chave privada de conta, e a cadeia fecha", () => {
    const telemovel = identityFromDeviceCert({
      address: pc.address,
      accountKey: pc.signingPublicKey,
      deviceSigningPrivateKey: telemovelPrivada,
      signature: certificado,
    })
    expect(telemovel.address).toBe(pc.address)
    expect(telemovel.accountId).toBe(pc.accountId)
    expect(telemovel.signingPublicKey).toEqual(pc.signingPublicKey)
    expect(telemovel.deviceSigningPublicKey).toEqual(telemovelPublica)
    expect(telemovel.signingPrivateKey).toBeUndefined()
    expect(temChaveDeConta(telemovel)).toBe(false)
    expect(temChaveDeConta(pc)).toBe(true)
    expect(verifyDeviceChain(telemovel.credential)).toBe(true)
    // And the device key signs: that is what login and leaves need.
    const desafio = Uint8Array.from([1, 2, 3])
    expect(ed25519.verify(signWithDevice(telemovel, desafio), desafio, telemovelPublica)).toBe(true)
  })

  it("recusa assinar com a chave de conta: não a tem", () => {
    const telemovel = identityFromDeviceCert({
      address: pc.address,
      accountKey: pc.signingPublicKey,
      deviceSigningPrivateKey: telemovelPrivada,
      signature: certificado,
    })
    expect(() => sign(telemovel, Uint8Array.from([1]))).toThrow(/chave da conta/)
  })

  it("recusa uma cadeia que não fecha: outra conta, outro aparelho, outra assinatura", () => {
    const outra = contaDeTeste(22)
    expect(() =>
      identityFromDeviceCert({
        address: pc.address,
        accountKey: outra.publica,
        deviceSigningPrivateKey: telemovelPrivada,
        signature: certificado,
      }),
    ).toThrow()
    expect(() =>
      identityFromDeviceCert({
        address: pc.address,
        accountKey: pc.signingPublicKey,
        deviceSigningPrivateKey: ed25519.utils.randomSecretKey(),
        signature: certificado,
      }),
    ).toThrow()
    const partida = new Uint8Array(certificado)
    partida[3] = (partida[3] as number) ^ 0x01
    expect(() =>
      identityFromDeviceCert({
        address: pc.address,
        accountKey: pc.signingPublicKey,
        deviceSigningPrivateKey: telemovelPrivada,
        signature: partida,
      }),
    ).toThrow()
  })
})

describe("revogação de aparelho", () => {
  it("verifica-se contra a chave de conta, e só contra ela", () => {
    const ana = contaDeTeste(16)
    const eva = contaDeTeste(17)
    const aparelho = ed25519.getPublicKey(sha256(Uint8Array.from([16, 0xf4])))

    const assinatura = signDeviceRevocation(ana.privada, aparelho, ana.endereco)

    expect(verifyDeviceRevocation(ana.publica, aparelho, ana.endereco, assinatura)).toBe(true)
    // A stolen device does not revoke its siblings: what signs is the account.
    expect(verifyDeviceRevocation(eva.publica, aparelho, ana.endereco, assinatura)).toBe(false)
    expect(verifyDeviceRevocation(ana.publica, eva.publica, ana.endereco, assinatura)).toBe(false)
    expect(verifyDeviceRevocation(ana.publica, aparelho, eva.endereco, assinatura)).toBe(false)
  })

  /**
   * A certificate and a revocation say opposite things about the same key
   * pair. Without separate contexts, one's signature served as the other's
   * signature, and certifying a device would revoke it.
   */
  it("não se confunde com um certificado sobre o mesmo aparelho", () => {
    const ana = contaDeTeste(18)
    const aparelho = ed25519.getPublicKey(sha256(Uint8Array.from([18, 0xf5])))

    const certificado = signDeviceCert(ana.privada, aparelho, ana.endereco)

    expect(verifyDeviceRevocation(ana.publica, aparelho, ana.endereco, certificado)).toBe(false)
    expect(
      verifyDeviceChain({
        address: ana.endereco,
        accountKey: ana.publica,
        deviceKey: aparelho,
        signature: signDeviceRevocation(ana.privada, aparelho, ana.endereco),
      }),
    ).toBe(false)
    expect(deviceRevocationMessage(aparelho, ana.endereco)).not.toEqual(certificado)
  })

  it("recusa assinaturas e chaves com o tamanho errado, sem lançar", () => {
    const ana = contaDeTeste(19)
    const aparelho = ed25519.getPublicKey(sha256(Uint8Array.from([19, 0xf6])))
    const assinatura = signDeviceRevocation(ana.privada, aparelho, ana.endereco)

    expect(verifyDeviceRevocation(new Uint8Array(0), aparelho, ana.endereco, assinatura)).toBe(false)
    expect(verifyDeviceRevocation(ana.publica, new Uint8Array(5), ana.endereco, assinatura)).toBe(false)
    expect(verifyDeviceRevocation(ana.publica, aparelho, ana.endereco, new Uint8Array(3))).toBe(false)
  })
})
