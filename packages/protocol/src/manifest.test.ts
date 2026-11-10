import { ed25519 } from "@noble/curves/ed25519.js"
import { sha256 } from "@noble/hashes/sha2.js"
import { describe, expect, it } from "vitest"
import { canonicalize, toBase64 } from "./canonical.js"
import { APARELHOS_POR_CONTA, deviceCertMessage, deviceRevocationMessage } from "./identity.js"
import { accountIdFromSigningKey, makeUserAddress, parseServerName } from "./ids.js"
import {
  aparelhosDoManifestoSeguinte,
  aparelhosRetirados,
  aparelhosRevogados,
  aparelhosSemORevogado,
  deviceManifestMessage,
  DeviceManifestWire,
  signDeviceManifest,
  verifyDeviceManifest,
  VERSAO_MAXIMA,
  type DeviceManifestWire as Wire,
} from "./manifest.js"
import { parseClientFrame, parseServerFrame } from "./wire.js"

/**
 * The device manifest, signed by the account and verified by the reader.
 *
 * What lives here is what the server CANNOT do: add a device, remove one,
 * change the version, or sign on behalf of another account. Each of those is a
 * field mutation after signing, and each one has to give a reason, not an
 * exception: whoever verifies is deciding whether to keep it or admit it, and
 * a contracted refusal is a reason.
 *
 * And what the server CAN do, which is serve an old manifest, doesn't live here
 * because it's not the verifier who catches it: it's whoever stores the highest
 * version they've seen. That's in the vault and on the server, each with its
 * own test.
 */

const SERVIDOR = parseServerName("orwell.pt")

function conta(semente: number) {
  const privada = sha256(Uint8Array.from([semente & 0xff, (semente >>> 8) & 0xff]))
  const publica = ed25519.getPublicKey(privada)
  return { privada, publica, address: makeUserAddress(accountIdFromSigningKey(publica), SERVIDOR) }
}

function aparelho(semente: number): Uint8Array {
  return ed25519.getPublicKey(sha256(Uint8Array.from([0xaa, semente & 0xff])))
}

const ANA = conta(1)
const BENTO = conta(2)

function manifestoDaAna(campos: Partial<Parameters<typeof signDeviceManifest>[1]> = {}): Wire {
  return signDeviceManifest(ANA.privada, {
    address: ANA.address,
    version: 1,
    devices: [{ deviceKey: aparelho(1), addedAt: 1_790_000_000 }],
    signedAt: 1_790_000_000,
    ...campos,
  })
}

describe("ida e volta", () => {
  it("o que a conta assina, quem lê verifica, e recebe as chaves em bytes", () => {
    const wire = manifestoDaAna({
      devices: [
        { deviceKey: aparelho(1), addedAt: 100 },
        { deviceKey: aparelho(2), addedAt: 200 },
      ],
    })
    const lido = verifyDeviceManifest(wire)
    expect(lido.ok).toBe(true)
    if (!lido.ok) return
    expect(lido.manifest.address).toBe(ANA.address)
    expect(lido.manifest.version).toBe(1)
    expect(lido.manifest.accountKey).toEqual(ANA.publica)
    expect(lido.manifest.devices.map((d) => d.deviceKey)).toEqual([aparelho(1), aparelho(2)])
    expect(lido.manifest.devices.map((d) => d.addedAt)).toEqual([100, 200])
    expect(lido.wire).toEqual(wire)
  })

  it("sobrevive a uma volta por JSON, que é como viaja", () => {
    const wire = manifestoDaAna()
    expect(verifyDeviceManifest(JSON.parse(JSON.stringify(wire))).ok).toBe(true)
  })

  it("a forma do fio passa pelo molde tal e qual sai do assinador", () => {
    expect(DeviceManifestWire.safeParse(manifestoDaAna()).success).toBe(true)
  })
})

describe("o que o servidor não pode fazer", () => {
  it("acrescentar um aparelho", () => {
    const wire = manifestoDaAna()
    const forjado = { ...wire, devices: [...wire.devices, { deviceKey: toBase64(aparelho(9)), addedAt: 5 }] }
    expect(verifyDeviceManifest(forjado)).toEqual({ ok: false, reason: "bad-signature" })
  })

  it("tirar um aparelho", () => {
    const wire = manifestoDaAna({
      devices: [
        { deviceKey: aparelho(1), addedAt: 1 },
        { deviceKey: aparelho(2), addedAt: 2 },
      ],
    })
    const forjado = { ...wire, devices: wire.devices.slice(0, 1) }
    expect(verifyDeviceManifest(forjado)).toEqual({ ok: false, reason: "bad-signature" })
  })

  it("mexer na versão, para cima ou para baixo", () => {
    const wire = manifestoDaAna({ version: 3 })
    expect(verifyDeviceManifest({ ...wire, version: 4 })).toEqual({ ok: false, reason: "bad-signature" })
    expect(verifyDeviceManifest({ ...wire, version: 2 })).toEqual({ ok: false, reason: "bad-signature" })
  })

  it("trocar a data", () => {
    const wire = manifestoDaAna()
    expect(verifyDeviceManifest({ ...wire, signedAt: wire.signedAt + 1 })).toEqual({ ok: false, reason: "bad-signature" })
    const devices = [{ ...(wire.devices[0] as Wire["devices"][number]), addedAt: 0 }]
    expect(verifyDeviceManifest({ ...wire, devices })).toEqual({ ok: false, reason: "bad-signature" })
  })

  it("assinar com outra chave: o Bento não publica em nome da Ana", () => {
    const wire = signDeviceManifest(BENTO.privada, {
      address: ANA.address,
      version: 1,
      devices: [{ deviceKey: aparelho(1), addedAt: 1 }],
      signedAt: 1,
    })
    // The key that signed is not the one the address is a hash of: it dies here,
    // before the signature, and it's the same guard as `verifyDeviceChain`.
    expect(verifyDeviceManifest(wire)).toEqual({ ok: false, reason: "key-mismatch" })
  })

  it("nem pôr a chave da Ana em cima de uma assinatura do Bento", () => {
    const doBento = signDeviceManifest(BENTO.privada, {
      address: ANA.address,
      version: 1,
      devices: [{ deviceKey: aparelho(1), addedAt: 1 }],
      signedAt: 1,
    })
    expect(verifyDeviceManifest({ ...doBento, accountKey: toBase64(ANA.publica) })).toEqual({
      ok: false,
      reason: "bad-signature",
    })
  })

  it("mudar o endereço para o de outra conta", () => {
    const wire = manifestoDaAna()
    expect(verifyDeviceManifest({ ...wire, address: BENTO.address })).toEqual({ ok: false, reason: "key-mismatch" })
  })
})

describe("recusa sem excepção", () => {
  it.each([
    ["nada", undefined],
    ["null", null],
    ["uma string", "manifesto"],
    ["um objecto vazio", {}],
    ["sem assinatura", (() => {
      const { signature: _s, ...resto } = manifestoDaAna()
      return resto
    })()],
    ["versão zero", { ...manifestoDaAna(), version: 0 }],
    ["versão fraccionária", { ...manifestoDaAna(), version: 1.5 }],
    ["lista vazia", { ...manifestoDaAna(), devices: [] }],
    ["chave curta", { ...manifestoDaAna(), devices: [{ deviceKey: "AAAA", addedAt: 1 }] }],
    ["assinatura curta", { ...manifestoDaAna(), signature: "AAAA" }],
    ["campo a mais", { ...manifestoDaAna(), extra: 1 }],
  ])("%s devolve bad-shape, e não lança", (_rotulo, raw) => {
    if (_rotulo === "campo a mais") {
      // The zod schema throws away what it doesn't know, and the signature still
      // closes over the fields it knows: an extra field is not forging anything.
      expect(verifyDeviceManifest(raw).ok).toBe(true)
      return
    }
    expect(verifyDeviceManifest(raw)).toEqual({ ok: false, reason: "bad-shape" })
  })

  it("um endereço de espaço (!) não é de conta", () => {
    const wire = manifestoDaAna()
    expect(verifyDeviceManifest({ ...wire, address: `!${wire.address.slice(1)}` })).toEqual({ ok: false, reason: "bad-shape" })
  })

  it("a mesma chave de aparelho duas vezes", () => {
    const wire = manifestoDaAna()
    const repetido = { ...wire, devices: [wire.devices[0], wire.devices[0]] }
    expect(verifyDeviceManifest(repetido)).toEqual({ ok: false, reason: "duplicate-device" })
    expect(() =>
      signDeviceManifest(ANA.privada, {
        address: ANA.address,
        version: 1,
        devices: [
          { deviceKey: aparelho(1), addedAt: 1 },
          { deviceKey: aparelho(1), addedAt: 2 },
        ],
        signedAt: 1,
      }),
    ).toThrow(/duas vezes/)
  })

  it("mais aparelhos do que o tecto: o quinto não cabe, nem assinado", () => {
    const cinco = [1, 2, 3, 4, 5].map((n) => ({ deviceKey: aparelho(n), addedAt: n }))
    expect(APARELHOS_POR_CONTA).toBe(4)
    expect(() => signDeviceManifest(ANA.privada, { address: ANA.address, version: 1, devices: cinco, signedAt: 1 })).toThrow()
    const quatro = manifestoDaAna({ devices: cinco.slice(0, 4) })
    expect(verifyDeviceManifest(quatro).ok).toBe(true)
    // And a server or client that receives it with five fields refuses it on shape,
    // before spending a signature check.
    const forjado = { ...quatro, devices: [...quatro.devices, { deviceKey: toBase64(aparelho(5)), addedAt: 5 }] }
    expect(verifyDeviceManifest(forjado)).toEqual({ ok: false, reason: "bad-shape" })
  })
})

/**
 * The next manifest list, and the rule that made it exist.
 *
 * The cut was `[...existentes, ...novas].sort(addedAt).slice(-4)`, and with a
 * full account it threw away the oldest one, which is the computer, added the
 * day the account was born. Publishing a manifest without the key that signs
 * it is the account hiding from itself: it stops being admitted in new channels,
 * adds itself again on the next login, and kicks out another. If the kicked one
 * is a paired phone, it has no account key to restore with, and there's no
 * revocation.
 */
describe("os aparelhos do manifesto seguinte", () => {
  const meu = aparelho(9)

  it("com o tecto cheio e o próprio entre eles, quem sai é o outro mais antigo, nunca o próprio", () => {
    // The owner is the OLDEST, which is the real case: the computer that created
    // the account. By the old rule, it would be the one to leave.
    const existentes = [
      { deviceKey: meu, addedAt: 100 },
      { deviceKey: aparelho(1), addedAt: 200 },
      { deviceKey: aparelho(2), addedAt: 300 },
      { deviceKey: aparelho(3), addedAt: 400 },
    ]
    const lista = aparelhosDoManifestoSeguinte(existentes, [aparelho(4)], meu, 500)

    expect(lista).toHaveLength(APARELHOS_POR_CONTA)
    expect(lista.map((device) => toBase64(device.deviceKey))).toEqual(
      [meu, aparelho(2), aparelho(3), aparelho(4)].map(toBase64),
    )
    // And the final order is still by `addedAt`, which is what the manifest shows.
    expect(lista.map((device) => device.addedAt)).toEqual([100, 300, 400, 500])
  })

  it("o próprio fora da lista entra e nunca é cortado, mesmo com o tecto já cheio de outros", () => {
    const outros = [1, 2, 3, 4].map((n) => ({ deviceKey: aparelho(n), addedAt: n * 100 }))
    const lista = aparelhosDoManifestoSeguinte(outros, [meu], meu, 500)

    expect(lista).toHaveLength(APARELHOS_POR_CONTA)
    expect(lista.map((device) => toBase64(device.deviceKey))).toContain(toBase64(meu))
    // The oldest of the OTHERS left.
    expect(lista.map((device) => toBase64(device.deviceKey))).not.toContain(toBase64(aparelho(1)))
  })

  it("uma chave que já lá está não se repete nem muda de data", () => {
    const existentes = [{ deviceKey: meu, addedAt: 100 }]
    const lista = aparelhosDoManifestoSeguinte(existentes, [meu, aparelho(1)], meu, 500)

    expect(lista).toEqual([
      { deviceKey: meu, addedAt: 100 },
      { deviceKey: aparelho(1), addedAt: 500 },
    ])
    // And what comes out of here is signable: that's what it's for.
    expect(verifyDeviceManifest(manifestoDaAna({ devices: lista })).ok).toBe(true)
  })

  it("abaixo do tecto não corta nada", () => {
    const existentes = [{ deviceKey: meu, addedAt: 100 }]
    expect(aparelhosDoManifestoSeguinte(existentes, [aparelho(1)], meu, 200)).toHaveLength(2)
  })
})

describe("o tecto da versão", () => {
  it("a versão máxima passa, e a seguinte não, nem assinada à mão", () => {
    expect(VERSAO_MAXIMA).toBe(1_000_000)
    expect(verifyDeviceManifest(manifestoDaAna({ version: VERSAO_MAXIMA })).ok).toBe(true)
    expect(() => manifestoDaAna({ version: VERSAO_MAXIMA + 1 })).toThrow()

    // An account that signs by hand a version above the cap (it can: the key is
    // theirs) would lock itself forever on every reader. The shape refuses it
    // before the signature.
    const unsigned = { address: ANA.address, version: VERSAO_MAXIMA + 1, devices: [{ deviceKey: toBase64(aparelho(1)), addedAt: 1 }], signedAt: 1 }
    const forjado = { ...unsigned, accountKey: toBase64(ANA.publica), signature: toBase64(ed25519.sign(deviceManifestMessage(unsigned), ANA.privada)) }
    expect(verifyDeviceManifest(forjado)).toEqual({ ok: false, reason: "bad-shape" })
    expect(verifyDeviceManifest({ ...forjado, version: Number.MAX_SAFE_INTEGER })).toEqual({ ok: false, reason: "bad-shape" })
  })
})

describe("a canonicalização", () => {
  it("a ordem das chaves do objecto não muda a assinatura", () => {
    const wire = manifestoDaAna()
    const baralhado = {
      signature: wire.signature,
      signedAt: wire.signedAt,
      devices: wire.devices.map((d) => ({ addedAt: d.addedAt, deviceKey: d.deviceKey })),
      accountKey: wire.accountKey,
      version: wire.version,
      address: wire.address,
    }
    expect(verifyDeviceManifest(baralhado).ok).toBe(true)
  })

  it("a ordem dos aparelhos na lista FAZ parte do que se assina", () => {
    const wire = manifestoDaAna({
      devices: [
        { deviceKey: aparelho(1), addedAt: 1 },
        { deviceKey: aparelho(2), addedAt: 2 },
      ],
    })
    expect(verifyDeviceManifest({ ...wire, devices: [...wire.devices].reverse() })).toEqual({
      ok: false,
      reason: "bad-signature",
    })
  })

  it("assinar duas vezes o mesmo dá os mesmos bytes: Ed25519 é determinístico e o JSON também", () => {
    expect(manifestoDaAna()).toEqual(manifestoDaAna())
  })

  it("a mensagem assinada leva o contexto à cabeça, e não é a de um certificado nem a de uma revogação", () => {
    const unsigned = { address: ANA.address, version: 1, devices: [{ deviceKey: toBase64(aparelho(1)), addedAt: 1 }], signedAt: 1 }
    const mensagem = deviceManifestMessage(unsigned)
    const contexto = new TextEncoder().encode("orwell:device-manifest:v1\0")
    expect(Array.from(mensagem.subarray(0, contexto.length))).toEqual(Array.from(contexto))
    expect(new TextDecoder().decode(mensagem.subarray(contexto.length))).toBe(canonicalize(unsigned))

    // The three account contexts, read to the NUL: none is a prefix of another.
    const ateAoNul = (bytes: Uint8Array) => new TextDecoder().decode(bytes.subarray(0, bytes.indexOf(0) + 1))
    const contextos = [
      ateAoNul(mensagem),
      ateAoNul(deviceCertMessage(aparelho(1), ANA.address)),
      ateAoNul(deviceRevocationMessage(aparelho(1), ANA.address)),
    ]
    expect(contextos).toEqual(["orwell:device-manifest:v1\0", "orwell:device-cert:v1\0", "orwell:device-revoke:v1\0"])
  })
})

describe("no fio", () => {
  it("manifest.publish e manifest.get são tramas do cliente", () => {
    const wire = manifestoDaAna()
    expect(parseClientFrame({ t: "manifest.publish", manifest: wire })).toEqual({ t: "manifest.publish", manifest: wire })
    expect(parseClientFrame({ t: "manifest.get", address: ANA.address })).toEqual({ t: "manifest.get", address: ANA.address })
    expect(() => parseClientFrame({ t: "manifest.publish", manifest: { ...wire, devices: [] } })).toThrow()
  })

  it("manifest.result leva o manifesto ou null, e manifest.published leva o veredicto", () => {
    const wire = manifestoDaAna()
    expect(parseServerFrame({ t: "manifest.result", address: ANA.address, manifest: null }).t).toBe("manifest.result")
    expect(parseServerFrame({ t: "manifest.result", address: ANA.address, manifest: wire }).t).toBe("manifest.result")
    expect(parseServerFrame({ t: "manifest.published", address: ANA.address, version: 1, ok: true }).t).toBe("manifest.published")
    expect(
      parseServerFrame({ t: "manifest.published", address: ANA.address, version: 1, ok: false, reason: "stale-version" }).t,
    ).toBe("manifest.published")
    expect(() => parseServerFrame({ t: "manifest.published", address: ANA.address, version: 1, ok: false, reason: "x" })).toThrow()
  })

  it("o hello.ok aceita retentionDays, e continua a aceitar a ausência", () => {
    expect(parseServerFrame({ t: "hello.ok", version: 1, server: "s", capabilities: [], retentionDays: 30 })).toMatchObject({ retentionDays: 30 })
    expect(parseServerFrame({ t: "hello.ok", version: 1, server: "s", capabilities: [] })).not.toHaveProperty("retentionDays")
  })
})

describe("revogação: o manifesto seguinte e a diferença que o servidor lê", () => {
  const a = { deviceKey: aparelho(1), addedAt: 100 }
  const b = { deviceKey: aparelho(2), addedAt: 200 }
  const c = { deviceKey: aparelho(3), addedAt: 300 }

  it("tira só o revogado e mantém a ordem dos outros", () => {
    const lista = aparelhosSemORevogado([a, b, c], aparelho(2), aparelho(1))
    expect(lista.map((d) => toBase64(d.deviceKey))).toEqual([toBase64(aparelho(1)), toBase64(aparelho(3))])
    expect(lista.map((d) => d.addedAt)).toEqual([100, 300])
  })

  it("um aparelho não se revoga a si próprio", () => {
    expect(() => aparelhosSemORevogado([a, b], aparelho(1), aparelho(1))).toThrow("device-revoke-self")
  })

  it("revogar o que não está no manifesto é recusado, com a chave na causa", () => {
    let erro: unknown
    try {
      aparelhosSemORevogado([a, b], aparelho(9), aparelho(1))
    } catch (e) {
      erro = e
    }
    expect((erro as Error).message).toBe("device-not-in-manifest")
    expect((erro as Error).cause).toEqual({ device: toBase64(aparelho(9)) })
  })

  it("a diferença entre dois manifestos assinados é o que saiu, e só isso", () => {
    const v1 = manifestoDaAna({ devices: [a, b, c] })
    const v2 = manifestoDaAna({ version: 2, devices: [a, c] })
    expect(aparelhosRetirados(v1, v2)).toEqual([toBase64(aparelho(2))])
    // Adding is not revoking.
    expect(aparelhosRetirados(v2, v1)).toEqual([])
    // The first manifest revokes nothing.
    expect(aparelhosRetirados(null, v2)).toEqual([])
  })

  it("o corte pelo tecto conta como saída, mas não como revogação: ninguém o pediu (I2)", () => {
    const quatro = [a, b, c, { deviceKey: aparelho(4), addedAt: 400 }]
    const v1 = manifestoDaAna({ devices: quatro })
    const seguinte = aparelhosDoManifestoSeguinte(quatro, [aparelho(5)], aparelho(5), 500)
    const v2 = manifestoDaAna({ version: 2, devices: seguinte })
    expect(aparelhosRetirados(v1, v2)).toEqual([toBase64(aparelho(1))])
    // A 0.5.7 client doesn't send `revoke`: it leaves, and doesn't get revoked.
    expect(aparelhosRevogados(v1, v2, undefined)).toEqual([])
    expect(aparelhosRevogados(v1, v2, [])).toEqual([])
  })

  it("revogado é o que sai E vem pedido; um pedido que o manifesto ainda lista não revoga (I2)", () => {
    const v1 = manifestoDaAna({ devices: [a, b, c] })
    const v2 = manifestoDaAna({ version: 2, devices: [a, c] })
    expect(aparelhosRevogados(v1, v2, [toBase64(aparelho(2))])).toEqual([toBase64(aparelho(2))])
    // Asking for C, which stays, doesn't revoke it; nor one that was never there.
    expect(aparelhosRevogados(v1, v2, [toBase64(aparelho(3)), toBase64(aparelho(9))])).toEqual([])
    // The first manifest revokes nothing, no matter what you ask for.
    expect(aparelhosRevogados(null, v2, [toBase64(aparelho(2))])).toEqual([])
  })
})
