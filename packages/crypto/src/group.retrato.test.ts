import { EXTENSAO_PERMISSOES, EXTENSAO_RETRATO, generateIdentity, parseServerName } from "@enclave/protocol"
import { generateKeyPackageWithKey, defaultCapabilities, defaultLifetime, type KeyPackage } from "ts-mls"
import { describe, expect, it } from "vitest"
import {
  addMembers,
  createChannel,
  declaraPermissoes,
  declaraRetrato,
  generateKeyPackages,
  joinChannel,
  joinChannelComExtensoes,
  retratoDasExtensoes,
} from "./group.js"
import { memberAddresses } from "./sender.js"
import { loadSuite } from "./suite.js"
import { encodeDeviceCredential } from "@enclave/protocol"

/**
 * The channel snapshot in the Welcome (phase 1 of `docs/planos/estado-cifrado-plano.md`).
 * The extension goes in the Welcome's `GroupInfo`, both ways; and a Welcome with it
 * opens in the usual `joinGroup`, which is what a 1.0.x client does.
 */

const HOME = parseServerName("enclave.test")
const CANAL = "!retrato:enclave.test"
const RETRATO = new TextEncoder().encode(JSON.stringify({ v: 1, canal: CANAL, itens: [], geradoEm: 1 }))

async function pacoteDe(identidade: ReturnType<typeof generateIdentity>) {
  const [pacote] = await generateKeyPackages(identidade, 1)
  if (!pacote) throw new Error("sem key package")
  return pacote
}

/** A key package like a 1.0.x client's: the default capabilities, without the extension. */
async function pacoteAntigo(identidade: ReturnType<typeof generateIdentity>): Promise<KeyPackage> {
  const suite = await loadSuite()
  const gerado = await generateKeyPackageWithKey(
    { credentialType: "basic", identity: encodeDeviceCredential(identidade.credential) },
    { ...defaultCapabilities(), ciphersuites: ["MLS_256_XWING_CHACHA20POLY1305_SHA512_Ed25519", "MLS_128_DHKEMX25519_CHACHA20POLY1305_SHA256_Ed25519"] },
    defaultLifetime,
    [],
    { signKey: identidade.deviceSigningPrivateKey, publicKey: identidade.deviceSigningPublicKey },
    suite,
  )
  return gerado.publicPackage
}

describe("o retrato no Welcome", () => {
  it("as folhas novas declaram a extensão; um pacote antigo não", async () => {
    const ana = generateIdentity(HOME)
    const pacote = await pacoteDe(ana)
    expect(pacote.publicPackage.leafNode.capabilities.extensions).toContain(EXTENSAO_RETRATO)
    expect(declaraRetrato(pacote.publicPackage)).toBe(true)
    expect(declaraRetrato(await pacoteAntigo(ana))).toBe(false)
  })

  it("as folhas novas declaram também o modelo de permissões (1.2); um pacote antigo não", async () => {
    const ana = generateIdentity(HOME)
    const pacote = await pacoteDe(ana)
    expect(pacote.publicPackage.leafNode.capabilities.extensions).toContain(EXTENSAO_PERMISSOES)
    expect(declaraPermissoes(pacote.publicPackage)).toBe(true)
    expect(declaraPermissoes(await pacoteAntigo(ana))).toBe(false)
  })

  it("vai e volta: quem entra lê exactamente os bytes que quem convida pôs", async () => {
    const ana = generateIdentity(HOME)
    const carla = generateIdentity(HOME)
    const sala = await createChannel(ana, CANAL)
    const pacote = await pacoteDe(carla)
    const entrada = await addMembers(sala, [pacote.publicPackage], { retrato: RETRATO })
    const { session, extensoes } = await joinChannelComExtensoes(CANAL, entrada.welcome, pacote.publicPackage, pacote.privatePackage)
    expect(retratoDasExtensoes(extensoes)).toEqual(RETRATO)
    expect(new Set(memberAddresses(session.state.ratchetTree).values()).size).toBe(2)
  })

  it("sem retrato, não há extensão", async () => {
    const ana = generateIdentity(HOME)
    const carla = generateIdentity(HOME)
    const sala = await createChannel(ana, CANAL)
    const pacote = await pacoteDe(carla)
    const entrada = await addMembers(sala, [pacote.publicPackage])
    const { extensoes } = await joinChannelComExtensoes(CANAL, entrada.welcome, pacote.publicPackage, pacote.privatePackage)
    expect(retratoDasExtensoes(extensoes)).toBeNull()
  })

  it("um Welcome com o retrato abre no joinGroup de sempre (o de um cliente 1.0.x)", async () => {
    const ana = generateIdentity(HOME)
    const carla = generateIdentity(HOME)
    const sala = await createChannel(ana, CANAL)
    const pacote = await pacoteDe(carla)
    const entrada = await addMembers(sala, [pacote.publicPackage], { retrato: RETRATO })
    const lugar = await joinChannel(CANAL, entrada.welcome, pacote.publicPackage, pacote.privatePackage)
    expect(lugar.state.groupContext.epoch).toBe(entrada.session.state.groupContext.epoch)
  })

  it("a folha antiga entra na mesma num grupo de folhas novas, e o contexto não exige a extensão", async () => {
    const ana = generateIdentity(HOME)
    const sala = await createChannel(ana, CANAL)
    const antigo = await pacoteAntigo(generateIdentity(HOME))
    const entrada = await addMembers(sala, [antigo])
    // No extension in the group context: a `required_capabilities` here would have expelled the old ones.
    expect(entrada.session.state.groupContext.extensions.filter((e) => e.extensionType === "required_capabilities")).toEqual([])
    expect(new Set(memberAddresses(entrada.session.state.ratchetTree).values()).size).toBe(2)
  })

  it("o servidor não troca o retrato: um byte mexido no Welcome e não abre", async () => {
    const ana = generateIdentity(HOME)
    const carla = generateIdentity(HOME)
    const sala = await createChannel(ana, CANAL)
    const pacote = await pacoteDe(carla)
    const entrada = await addMembers(sala, [pacote.publicPackage], { retrato: RETRATO })
    const mexido = new Uint8Array(entrada.welcome)
    mexido[mexido.length - 40] = (mexido[mexido.length - 40] ?? 0) ^ 0x01
    await expect(joinChannelComExtensoes(CANAL, mexido, pacote.publicPackage, pacote.privatePackage)).rejects.toThrow()
  })
})
