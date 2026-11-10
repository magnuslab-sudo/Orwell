import {
  accountIdFromSigningKey,
  base32Encode,
  encodeDeviceCredential,
  makeUserAddress,
  parseServerName,
  signDeviceCert,
  type UserAddress,
} from "@enclave/protocol"
import { ed25519 } from "@noble/curves/ed25519.js"
import { sha256 } from "@noble/hashes/sha2.js"
import type { Credential } from "ts-mls"
import { describe, expect, it } from "vitest"
import { addressBindingAuthService } from "./suite.js"

/**
 * The binding between the claimed address and the key that signs is the only
 * thing that stops someone from joining a room under another person's name:
 * there is no certificate authority behind it, only this local recomputation. When
 * the identifier got shorter, this check became what decides what
 * survives, hence the hard-cut test further down, which pins in writing that
 * the previous MLS state stops validating, instead of letting that be discovered
 * in production.
 *
 * V2 has three links instead of one direct digest, and the new half of these
 * tests exists for the third: without it, a valid credential copied from
 * another person would work for any leaf.
 *
 * **Refusal is silent, and that is what the second half locks down.** Nothing
 * here can throw: a rejected leaf is a leaf that does not get in, and an exception
 * escaping `validateCredential` would be a different failure from the one
 * promised, bubbling up a path that does not always catch it. That is why the
 * garbage tests assert `resolves.toBe(false)` and not `rejects`.
 */

const SERVIDOR = parseServerName("orwell.pt")

function privadaDeTeste(semente: number): Uint8Array {
  return sha256(Uint8Array.from([semente & 0xff, (semente >>> 8) & 0xff]))
}

interface Conta {
  privada: Uint8Array
  publica: Uint8Array
  endereco: UserAddress
}

function conta(semente: number): Conta {
  const privada = privadaDeTeste(semente)
  const publica = ed25519.getPublicKey(privada)
  return { privada, publica, endereco: makeUserAddress(accountIdFromSigningKey(publica), SERVIDOR) }
}

function chaveDeAparelho(semente: number): Uint8Array {
  return ed25519.getPublicKey(privadaDeTeste(semente + 1000))
}

/** The full chain, with the option to lie at any link. */
function cadeia(opcoes: {
  conta: Conta
  aparelho: Uint8Array
  /** The address written on the credential, when it is not the account's. */
  endereco?: string
  /** Who signs the certificate, when it is not the account itself. */
  assinante?: Conta
}): Uint8Array {
  const endereco = (opcoes.endereco ?? opcoes.conta.endereco) as UserAddress
  const assinante = opcoes.assinante ?? opcoes.conta
  return encodeDeviceCredential({
    address: endereco,
    accountKey: opcoes.conta.publica,
    deviceKey: opcoes.aparelho,
    signature: signDeviceCert(assinante.privada, opcoes.aparelho, endereco),
  })
}

function credencial(bytes: Uint8Array): Credential {
  return { credentialType: "basic", identity: bytes }
}

describe("addressBindingAuthService", () => {
  it("aceita a credencial cujo endereço é o resumo da chave que a assina", async () => {
    const ana = conta(1)
    const aparelho = chaveDeAparelho(1)

    expect(await addressBindingAuthService.validateCredential(credencial(cadeia({ conta: ana, aparelho })), aparelho)).toBe(
      true,
    )
  })

  it("recusa quem reclame o endereço de outra pessoa", async () => {
    const minha = conta(2)
    const alheia = conta(3)
    const aparelho = chaveDeAparelho(2)

    // The chain is internally consistent (my account signed my device), but the
    // address is someone else's, and the address is the account digest.
    const forjada = cadeia({ conta: minha, aparelho, endereco: alheia.endereco })

    expect(await addressBindingAuthService.validateCredential(credencial(forjada), aparelho)).toBe(false)
  })

  /**
   * The cut is hard by choice. Accepting the old form too would keep groups
   * standing, but at the price of the same person now having two addresses, and
   * since admin lists, founding records and friendships are stored by address, it
   * would be one identity split in two instead of a migration.
   */
  it("recusa o endereço longo antigo, ainda que derivado da mesma chave", async () => {
    const ana = conta(4)
    const aparelho = chaveDeAparelho(4)
    const antigo = makeUserAddress(base32Encode(sha256(ana.publica).subarray(0, 16)), SERVIDOR)

    expect(antigo).toHaveLength(`@:${SERVIDOR}`.length + 26)
    expect(
      await addressBindingAuthService.validateCredential(credencial(cadeia({ conta: ana, aparelho, endereco: antigo })), aparelho),
    ).toBe(false)
  })

  it("recusa uma credencial de espaço, que nunca assina nada", async () => {
    const ana = conta(5)
    const aparelho = chaveDeAparelho(5)
    const espaco = `!${accountIdFromSigningKey(ana.publica)}:${SERVIDOR}`

    expect(
      await addressBindingAuthService.validateCredential(credencial(cadeia({ conta: ana, aparelho, endereco: espaco })), aparelho),
    ).toBe(false)
  })

  it("recusa o que não seja uma credencial básica, e o que não seja sequer texto", async () => {
    const aparelho = chaveDeAparelho(6)

    expect(
      await addressBindingAuthService.validateCredential({ credentialType: "x509", certificates: [] }, aparelho),
    ).toBe(false)
    expect(
      await addressBindingAuthService.validateCredential(credencial(Uint8Array.from([0xff, 0xfe, 0xfd])), aparelho),
    ).toBe(false)
  })

  /**
   * The third link, and why it exists.
   *
   * A valid credential is public: it travels in the tree, and any member reads it.
   * Without binding the device key to the key that signs the leaf, copying
   * someone else's credential to our leaf would let us speak as them:
   * the first two links would still close perfectly.
   */
  it("recusa a folha assinada por um aparelho que a conta não certificou", async () => {
    const ana = conta(7)
    const certificado = chaveDeAparelho(7)
    const intruso = chaveDeAparelho(8)

    const roubada = cadeia({ conta: ana, aparelho: certificado })

    expect(await addressBindingAuthService.validateCredential(credencial(roubada), certificado)).toBe(true)
    expect(await addressBindingAuthService.validateCredential(credencial(roubada), intruso)).toBe(false)
  })

  it("recusa a cadeia certificada por outra conta que não a do endereço", async () => {
    const ana = conta(9)
    const eva = conta(10)
    const aparelho = chaveDeAparelho(9)

    // Everything checks out except the signer: Eva certified a device as if it belonged to
    // Ana. This is the server inventing a device, and it stops here.
    const forjada = cadeia({ conta: ana, aparelho, assinante: eva })

    expect(await addressBindingAuthService.validateCredential(credencial(forjada), aparelho)).toBe(false)
  })

  it("recusa a credencial da v1, que era o endereço em texto e mais nada", async () => {
    const ana = conta(11)
    const aparelho = chaveDeAparelho(11)

    const v1 = new TextEncoder().encode(ana.endereco)

    expect(await addressBindingAuthService.validateCredential(credencial(v1), aparelho)).toBe(false)
    // Nor does it pass when presented with the account key, which is how v1 validated:
    // the cut is the cut.
    expect(await addressBindingAuthService.validateCredential(credencial(v1), ana.publica)).toBe(false)
  })

  it("um byte a mais no fim é recusado, e não ignorado como enchimento", async () => {
    const ana = conta(12)
    const aparelho = chaveDeAparelho(12)
    const boa = cadeia({ conta: ana, aparelho })

    const comLixo = new Uint8Array(boa.length + 1)
    comLixo.set(boa, 0)
    comLixo[boa.length] = 0x00

    await expect(addressBindingAuthService.validateCredential(credencial(comLixo), aparelho)).resolves.toBe(false)
  })

  it("qualquer prefixo truncado é recusado em silêncio", async () => {
    const ana = conta(13)
    const aparelho = chaveDeAparelho(13)
    const boa = cadeia({ conta: ana, aparelho })

    for (let corte = 0; corte < boa.length; corte++) {
      // `resolves` not `rejects`: an exception here would be the wrong failure.
      await expect(addressBindingAuthService.validateCredential(credencial(boa.subarray(0, corte)), aparelho)).resolves.toBe(
        false,
      )
    }
  })

  /**
   * One byte changed at any position, from first to last.
   *
   * There is not a single place in this credential where a change goes unnoticed:
   * the magic and version lock the format, the keys and address bind to the
   * digest, the signature binds everything else, and the address length binds
   * to the total size. This proves that validation does not just look at the
   * start of the structure.
   */
  it("um byte trocado em qualquer posição derruba a cadeia, sem excepção nenhuma", async () => {
    const ana = conta(14)
    const aparelho = chaveDeAparelho(14)
    const boa = cadeia({ conta: ana, aparelho })

    for (let posicao = 0; posicao < boa.length; posicao++) {
      const torta = Uint8Array.from(boa)
      torta[posicao] = (torta[posicao] as number) ^ 0x01
      await expect(addressBindingAuthService.validateCredential(credencial(torta), aparelho)).resolves.toBe(false)
    }
  })

  it("uma credencial vazia é recusada", async () => {
    await expect(
      addressBindingAuthService.validateCredential(credencial(new Uint8Array(0)), chaveDeAparelho(15)),
    ).resolves.toBe(false)
  })
})
