import { generateIdentity, identityFromPrivateKey, parseServerName, type Payload } from "@enclave/protocol"
import { decodeMlsMessage, encodeMlsMessage, joinGroupExternal } from "ts-mls"
import { describe, expect, it } from "vitest"
import {
  addMembers,
  createChannel,
  declaredEpoch,
  encryptPayload,
  epochOf,
  generateKeyPackages,
  joinChannel,
  joinChannelExternally,
  memberLeaves,
  publishableGroupInfo,
  receive,
  rotateEpoch,
  type GroupSession,
} from "./group.js"
import { enclaveClientConfig, loadSuite } from "./suite.js"

const HOME = parseServerName("enclave.test")
const SALA = "!984:enclave.test"

function texto(corpo: string): Payload {
  return { t: "message", id: crypto.randomUUID(), sentAt: 1_700_000_000_000, body: corpo, attachments: [], mentions: [], links: [] }
}

async function aplicar(grupo: GroupSession, commit: Uint8Array): Promise<GroupSession> {
  const resultado = await receive(grupo, commit)
  if (resultado.kind !== "epoch") {
    throw new Error(`commit recusado: ${resultado.kind === "ignored" ? resultado.reason : resultado.kind}`)
  }
  return resultado.session
}

/**
 * Rejoin through the card with the SAME device.
 *
 * The shared production room closed this way on 12/9/2026. Whoever forgets the room
 * and comes back through the gate has the same device key, and `ts-mls` accepts a new
 * leaf with a key that is already on another leaf: it only compares the arriving leaf
 * against the ones already there when it validates an ENTIRE tree. From then on every
 * tree validation fails with "signature keys not unique"-the next card does not open
 * for anyone and no Add goes through. The room stays closed to whoever comes next,
 * with no error for whoever closed it.
 *
 * RFC 9420 §12.4.3.2 has the answer written out: the external commit can remove
 * the own old leaf (`resync`). These tests show, with the real library on both sides,
 * that joining uses it when needed and only when needed-and the room stays open after.
 */
describe("reentrada por cartão do mesmo aparelho", () => {
  it("tira a folha antiga em vez de deixar duas com a mesma chave, e a sala continua aberta", async () => {
    const dono = generateIdentity(HOME)
    const bento = generateIdentity(HOME)
    const novo = generateIdentity(HOME)
    const outro = generateIdentity(HOME)

    let sala = await createChannel(dono, SALA)
    const [primeira, segunda] = await generateKeyPackages(bento, 2)
    if (!primeira || !segunda) throw new Error("sem key packages")

    const entrada = await joinChannelExternally(SALA, await publishableGroupInfo(sala), primeira.publicPackage, primeira.privatePackage)
    expect(entrada.resync).toBe(false)
    sala = await aplicar(sala, entrada.commit)

    // Bento forgets the room and comes back through the door, with the same device.
    const reentrada = await joinChannelExternally(SALA, await publishableGroupInfo(sala), segunda.publicPackage, segunda.privatePackage)
    expect(reentrada.resync).toBe(true)
    sala = await aplicar(sala, reentrada.commit)
    expect(memberLeaves(sala, bento.address)).toHaveLength(1)
    expect(memberLeaves(reentrada.session, bento.address)).toHaveLength(1)

    // Whoever comes next enters by card...
    const [doNovo] = await generateKeyPackages(novo, 1)
    if (!doNovo) throw new Error("sem key package")
    const entradaDoNovo = await joinChannelExternally(SALA, await publishableGroupInfo(sala), doNovo.publicPackage, doNovo.privatePackage)
    sala = await aplicar(sala, entradaDoNovo.commit)
    const doBento = await aplicar(reentrada.session, entradaDoNovo.commit)

    // ...and by Add, which is the path for the caller.
    const [doOutro] = await generateKeyPackages(outro, 1)
    if (!doOutro) throw new Error("sem key package")
    const admissao = await addMembers(sala, [doOutro.publicPackage])
    sala = admissao.session
    const bentoDepois = await aplicar(doBento, admissao.commit)
    const salaDoOutro = await joinChannel(SALA, admissao.welcome, doOutro.publicPackage, doOutro.privatePackage)
    expect(epochOf(salaDoOutro)).toBe(epochOf(sala))

    // And Bento, who came back, is heard by whoever joined after him.
    const dito = await encryptPayload(bentoDepois, texto("voltei"))
    const ouvido = await receive(salaDoOutro, dito.ciphertext)
    expect(ouvido.kind).toBe("payload")
    if (ouvido.kind === "payload") expect(ouvido.payload).toMatchObject({ body: "voltei" })
  }, 60_000)

  it("outro aparelho da mesma conta não é confundido: ganha folha própria e a antiga fica", async () => {
    const dono = generateIdentity(HOME)
    const portatil = generateIdentity(HOME)
    // The same account, on another machine: same account key, different device key.
    const telemovel = identityFromPrivateKey(portatil.signingPrivateKey, HOME)

    let sala = await createChannel(dono, SALA)
    const [doPortatil] = await generateKeyPackages(portatil, 1)
    const [doTelemovel] = await generateKeyPackages(telemovel, 1)
    if (!doPortatil || !doTelemovel) throw new Error("sem key packages")

    sala = await aplicar(sala, (await joinChannelExternally(SALA, await publishableGroupInfo(sala), doPortatil.publicPackage, doPortatil.privatePackage)).commit)
    const segunda = await joinChannelExternally(SALA, await publishableGroupInfo(sala), doTelemovel.publicPackage, doTelemovel.privatePackage)
    expect(segunda.resync).toBe(false)
    sala = await aplicar(sala, segunda.commit)
    expect(memberLeaves(sala, portatil.address)).toHaveLength(2)
  }, 60_000)
})

/**
 * Removing an external entry, seen from whoever receives it.
 *
 * RFC 9420 §12.4.3.2 only lets an external commit remove the OLD leaf of whoever
 * joins-that is the `resync`. The library checks that there is at most one removal
 * and nothing else: with `acceptAll`, an external commit that removed someone else's
 * leaf would be applied by everyone. And an external commit is made with the card,
 * which any account on the server can pick up: it was a button to expel the owner
 * from the shared room within anyone's reach.
 *
 * The intruder here uses the library itself, only with the leaf comparison swapped
 * to point at the leaf they want to remove. It is valid MLS in everything else.
 */
describe("remoção num commit externo", () => {
  async function comRemocaoDe(alvo: Uint8Array, cartao: Uint8Array, intruso: ReturnType<typeof generateIdentity>): Promise<Uint8Array> {
    const decoded = decodeMlsMessage(cartao, 0)
    if (!decoded || decoded[0].wireformat !== "mls_group_info") throw new Error("cartão ilegível")
    const [pacote] = await generateKeyPackages(intruso, 1)
    if (!pacote) throw new Error("sem key package")
    const iguais = (a: Uint8Array, b: Uint8Array): boolean => a.length === b.length && a.every((byte, i) => byte === b[i])
    const config = {
      ...enclaveClientConfig(),
      keyPackageEqualityConfig: {
        compareKeyPackages: () => false,
        compareKeyPackageToLeafNode: (_: unknown, folha: { signaturePublicKey: Uint8Array }) => iguais(folha.signaturePublicKey, alvo),
      },
    }
    const { publicMessage } = await joinGroupExternal(
      decoded[0].groupInfo,
      pacote.publicPackage,
      pacote.privatePackage,
      true,
      await loadSuite(),
      undefined,
      config,
    )
    return encodeMlsMessage({ version: "mls10", wireformat: "mls_public_message", publicMessage })
  }

  it("de uma folha alheia — a do fundador — é recusado, e o grupo não avança", async () => {
    const dono = generateIdentity(HOME)
    const bento = generateIdentity(HOME)
    const intruso = generateIdentity(HOME)

    let sala = await createChannel(dono, SALA)
    const [doBento] = await generateKeyPackages(bento, 1)
    if (!doBento) throw new Error("sem key package")
    const entrada = await joinChannelExternally(SALA, await publishableGroupInfo(sala), doBento.publicPackage, doBento.privatePackage)
    sala = await aplicar(sala, entrada.commit)

    const golpe = await comRemocaoDe(dono.deviceSigningPublicKey, await publishableGroupInfo(sala), intruso)
    const noBento = await receive(entrada.session, golpe)
    expect(noBento.kind).toBe("ignored")
    expect(epochOf(noBento.session)).toBe(epochOf(entrada.session))
    expect(memberLeaves(noBento.session, dono.address)).toHaveLength(1)
  }, 60_000)

  it("controlo: o mesmo caminho, a remover a folha do próprio, é aceite", async () => {
    const dono = generateIdentity(HOME)
    const bento = generateIdentity(HOME)

    let sala = await createChannel(dono, SALA)
    const [doBento] = await generateKeyPackages(bento, 1)
    if (!doBento) throw new Error("sem key package")
    sala = await aplicar(sala, (await joinChannelExternally(SALA, await publishableGroupInfo(sala), doBento.publicPackage, doBento.privatePackage)).commit)

    const volta = await comRemocaoDe(bento.deviceSigningPublicKey, await publishableGroupInfo(sala), bento)
    const noDono = await receive(sala, volta)
    expect(noDono.kind).toBe("epoch")
    expect(memberLeaves(noDono.session, bento.address)).toHaveLength(1)
  }, 60_000)
})

/**
 * The epoch that a frame declares in plain text, read without opening anything.
 *
 * It is the number the one-commit-per-epoch rule needs, and it is what the server
 * reads: it is in the MLS header of a private message, a public one, and a
 * card. Client tests use it to build a server that applies the rule with real frames.
 */
describe("epoch declarada", () => {
  it("lê-se do commit de um membro, do commit externo, do cartão e de uma mensagem", async () => {
    const dono = generateIdentity(HOME)
    const recem = generateIdentity(HOME)
    let sala = await createChannel(dono, SALA)
    expect(declaredEpoch(await publishableGroupInfo(sala))).toBe(0n)

    const rotacao = await rotateEpoch(sala)
    expect(declaredEpoch(rotacao.commits[0] as Uint8Array)).toBe(0n)
    sala = rotacao.session

    const [pacote] = await generateKeyPackages(recem, 1)
    if (!pacote) throw new Error("sem key package")
    const externo = await joinChannelExternally(SALA, await publishableGroupInfo(sala), pacote.publicPackage, pacote.privatePackage)
    expect(declaredEpoch(externo.commit)).toBe(1n)
    sala = await aplicar(sala, externo.commit)

    expect(declaredEpoch((await encryptPayload(sala, texto("olá"))).ciphertext)).toBe(2n)
    expect(declaredEpoch(new Uint8Array([1, 2, 3]))).toBeUndefined()
  }, 60_000)
})
