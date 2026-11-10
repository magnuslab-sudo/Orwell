import { ed25519 } from "@noble/curves/ed25519.js"
import {
  encodeDeviceCredential,
  generateIdentity,
  identityFromPrivateKey,
  parseServerName,
  safetyNumber,
  signDeviceCert,
  type AccountIdentity,
  type Identity,
  type Payload,
} from "@enclave/protocol"
import { describe, expect, it } from "vitest"
import {
  addMembers,
  createChannel,
  credentialOfKeyPackage,
  decodeKeyPackage,
  encryptPayload,
  generateKeyPackages,
  joinChannel,
  memberAccountKey,
  memberLeaves,
  memberSigningKey,
  memberSigningKeys,
  receive,
  removeMembers,
  type GroupSession,
} from "./group.js"
import { leafIndexOf, leavesOf, memberAccounts, memberAddresses } from "./sender.js"

const HOME = parseServerName("enclave.test")
const OTHER = parseServerName("other.test")

function text(body: string, id = crypto.randomUUID()): Payload {
  return { t: "message", id, sentAt: 1_700_000_000_000, body, attachments: [], mentions: [], links: [] }
}

/**
 * The second device on the SAME account.
 *
 * The account key is the same (it IS the account, and the address is its digest),
 * and the device key is different, generated here. That's exactly what pairing
 * will produce: the account signs a new certificate for a new leaf key, and the
 * address stays the same. That the address doesn't change is the first assert in
 * almost every test below.
 */
function outroAparelho(conta: AccountIdentity, servidor = HOME): Identity {
  return identityFromPrivateKey(conta.signingPrivateKey, servidor, ed25519.utils.randomSecretKey())
}

/**
 * A channel where Alice has two devices and Bruno has one.
 *
 * Three leaves, two people. It's the smallest shape that tells "how many leaves"
 * apart from "how many people", and everything that follows rests on it.
 */
async function canalComDoisAparelhos() {
  const alicePortatil = generateIdentity(HOME)
  const aliceTelemovel = outroAparelho(alicePortatil)
  const bruno = generateIdentity(OTHER)

  const [kpTelemovel] = await generateKeyPackages(aliceTelemovel, 1)
  const [kpBruno] = await generateKeyPackages(bruno, 1)
  if (!kpTelemovel || !kpBruno) throw new Error("sem key packages")

  let sessaoPortatil = await createChannel(alicePortatil, "!geral:enclave.test")

  // Both join in the SAME commit, which is how a person with N devices will be added:
  // one commit, one Welcome, N Add proposals.
  const entrada = await addMembers(sessaoPortatil, [
    decodeKeyPackage(kpTelemovel.wire),
    decodeKeyPackage(kpBruno.wire),
  ])
  sessaoPortatil = entrada.session

  const sessaoTelemovel = await joinChannel(
    "!geral:enclave.test",
    entrada.welcome,
    kpTelemovel.publicPackage,
    kpTelemovel.privatePackage,
  )
  const sessaoBruno = await joinChannel(
    "!geral:enclave.test",
    entrada.welcome,
    kpBruno.publicPackage,
    kpBruno.privatePackage,
  )

  return { alicePortatil, aliceTelemovel, bruno, sessaoPortatil, sessaoTelemovel, sessaoBruno }
}

describe("a árvore com vários aparelhos por conta", () => {
  /**
   * The fact everything else rests on.
   *
   * Two leaves from the same account join the tree and are accepted, and they're
   * accepted without a single new line of validation code, because `addressBindingAuthService`
   * validates each leaf on its own: the address is the digest of the account key,
   * the account signed that device key, and the device key signs the leaf. Nothing
   * in that chain says "once only".
   */
  it("aceita duas folhas da mesma conta, com chaves de aparelho diferentes", async () => {
    const { alicePortatil, aliceTelemovel, bruno, sessaoPortatil } = await canalComDoisAparelhos()
    const arvore = sessaoPortatil.state.ratchetTree

    // Same account, same address, different devices.
    expect(aliceTelemovel.address).toBe(alicePortatil.address)
    expect(aliceTelemovel.signingPublicKey).toEqual(alicePortatil.signingPublicKey)
    expect(aliceTelemovel.deviceSigningPublicKey).not.toEqual(alicePortatil.deviceSigningPublicKey)

    // Three leaves, and Alice's address on two of them.
    expect(memberAddresses(arvore)).toEqual(
      new Map([
        [0, alicePortatil.address],
        [1, aliceTelemovel.address],
        [2, bruno.address],
      ]),
    )
  })

  /**
   * `leavesOf` returns ALL of them; `leafIndexOf` returns the first and no others.
   *
   * The difference between the two is the difference between kicking a person and
   * disconnecting one of their computers. It's pinned here so that swapping one for the other
   * shows red instead of a channel where the kicked person keeps reading.
   */
  it("separa as folhas de uma pessoa da primeira folha dela", async () => {
    const { alicePortatil, bruno, sessaoPortatil } = await canalComDoisAparelhos()
    const arvore = sessaoPortatil.state.ratchetTree

    expect(leavesOf(arvore, alicePortatil.address)).toEqual([0, 1])
    expect(leafIndexOf(arvore, alicePortatil.address)).toBe(0)

    expect(leavesOf(arvore, bruno.address)).toEqual([2])
    expect(leafIndexOf(arvore, bruno.address)).toBe(2)

    // Not in the tree: empty list, not a wrong leaf.
    const estranho = generateIdentity(HOME)
    expect(leavesOf(arvore, estranho.address)).toEqual([])
    expect(leafIndexOf(arvore, estranho.address)).toBeUndefined()
  })

  /**
   * Counting people and counting machines became two questions.
   *
   * `memberAddresses` answers the second and repeats the address of anyone with two
   * devices; `memberAccounts` answers the first. The member list on screen wants
   * the first; without it, Alice would show up twice on the channel's people list.
   */
  it("conta pessoas e conta folhas, e os dois números são diferentes", async () => {
    const { alicePortatil, bruno, sessaoPortatil } = await canalComDoisAparelhos()
    const arvore = sessaoPortatil.state.ratchetTree

    expect(memberAddresses(arvore).size).toBe(3)

    const pessoas = memberAccounts(arvore)
    expect(pessoas.size).toBe(2)
    expect(pessoas.get(alicePortatil.address)).toEqual([0, 1])
    expect(pessoas.get(bruno.address)).toEqual([2])
  })

  /**
   * Both devices read, both write, and anyone who receives sees one person.
   *
   * That's the whole multi-device promise in four asserts: what Bruno writes opens
   * on both of Alice's devices, and what comes from either of them reaches Bruno
   * with her address, not with two different names.
   */
  it("os dois aparelhos da mesma conta lêem e escrevem no canal", async () => {
    const { alicePortatil, sessaoPortatil, sessaoTelemovel, sessaoBruno } = await canalComDoisAparelhos()

    const doBruno = await encryptPayload(sessaoBruno, text("bom dia aos dois"))

    const noPortatil = await receive(sessaoPortatil, doBruno.ciphertext)
    const noTelemovel = await receive(sessaoTelemovel, doBruno.ciphertext)
    expect(noPortatil.kind).toBe("payload")
    expect(noTelemovel.kind).toBe("payload")

    // And the other way: the phone writes, and Bruno sees Alice, the person, not the
    // machine.
    const doTelemovel = await encryptPayload(sessaoTelemovel, text("daqui é o telemóvel"))
    const noBruno = await receive(sessaoBruno, doTelemovel.ciphertext)
    if (noBruno.kind !== "payload") throw new Error(`esperava payload, veio ${noBruno.kind}`)
    expect(noBruno.sender).toBe(alicePortatil.address)
  })

  /**
   * Which device it came from, not just who it came from.
   *
   * MLS already authenticated the leaf and we used to throw it away. Without it there's
   * no way to judge a `device.revoke`: revoker and revoked are the same account,
   * so the address tells nothing apart, and what does is the device key that
   * signed the payload.
   */
  it("diz de que aparelho veio cada mensagem", async () => {
    const { alicePortatil, aliceTelemovel, sessaoTelemovel, sessaoBruno } = await canalComDoisAparelhos()

    const doTelemovel = await encryptPayload(sessaoTelemovel, text("sou o segundo"))
    const noBruno = await receive(sessaoBruno, doTelemovel.ciphertext)
    if (noBruno.kind !== "payload") throw new Error(`esperava payload, veio ${noBruno.kind}`)

    expect(noBruno.senderLeaf).toBe(1)
    expect(noBruno.senderDeviceKey).toEqual(aliceTelemovel.deviceSigningPublicKey)
    // And it's not the key of the same person's other device, which is the confusion this
    // exists to make impossible.
    expect(noBruno.senderDeviceKey).not.toEqual(alicePortatil.deviceSigningPublicKey)
  })

  /** A person has as many leaf keys as devices. */
  it("devolve as chaves de aparelho todas de uma pessoa", async () => {
    const { alicePortatil, aliceTelemovel, bruno, sessaoBruno } = await canalComDoisAparelhos()

    expect(memberSigningKeys(sessaoBruno, alicePortatil.address)).toEqual([
      alicePortatil.deviceSigningPublicKey,
      aliceTelemovel.deviceSigningPublicKey,
    ])
    expect(memberSigningKeys(sessaoBruno, bruno.address)).toHaveLength(1)

    // The singular still exists and still returns the first, which is right where the unit
    // is the leaf, and a trap where the unit is the person.
    expect(memberSigningKey(sessaoBruno, alicePortatil.address)).toEqual(alicePortatil.deviceSigningPublicKey)

    const estranho = generateIdentity(HOME)
    expect(memberSigningKeys(sessaoBruno, estranho.address)).toEqual([])
  })

  /**
   * The safety number is of the PERSON, so it's the same from any of their devices.
   *
   * It's read aloud over the phone. If it changed with the machine the person was
   * on, it would change with no one in the middle, and a number that disagrees
   * by construction teaches you to ignore it.
   */
  it("o safety number não muda com o aparelho", async () => {
    const { alicePortatil, bruno, sessaoPortatil, sessaoTelemovel, sessaoBruno } = await canalComDoisAparelhos()

    const brunoVistoDoPortatil = memberAccountKey(sessaoPortatil, bruno.address)
    const brunoVistoDoTelemovel = memberAccountKey(sessaoTelemovel, bruno.address)
    const aliceVistaDoBruno = memberAccountKey(sessaoBruno, alicePortatil.address)
    expect(brunoVistoDoPortatil).not.toBeNull()
    expect(brunoVistoDoTelemovel).not.toBeNull()
    expect(aliceVistaDoBruno).not.toBeNull()

    const doLadoDoBruno = safetyNumber(bruno.signingPublicKey, aliceVistaDoBruno as Uint8Array)
    expect(safetyNumber(alicePortatil.signingPublicKey, brunoVistoDoPortatil as Uint8Array)).toBe(doLadoDoBruno)
    expect(safetyNumber(alicePortatil.signingPublicKey, brunoVistoDoTelemovel as Uint8Array)).toBe(doLadoDoBruno)
  })
})

describe("tirar uma pessoa que tem vários aparelhos", () => {
  /**
   * **The test that pays for the whole slice.**
   *
   * Kicking by leaf list removes the whole person in one commit, and none of
   * their devices reads the next epoch. The patch to `ts-mls` is what makes it
   * true: without it the removal goes out with no UpdatePath and the new epoch
   * derives from the old one, which is exactly the one the kicked devices have.
   */
  it("tira todos os aparelhos num commit, e nenhum deles lê a epoch seguinte", async () => {
    const { alicePortatil, sessaoPortatil, sessaoTelemovel, sessaoBruno } = await canalComDoisAparelhos()

    const folhas = memberLeaves(sessaoBruno, alicePortatil.address)
    expect(folhas).toEqual([0, 1])

    const expulsao = await removeMembers(sessaoBruno, folhas)
    expect(expulsao.commits).toHaveLength(1)

    const depois = await encryptPayload(expulsao.session, text("já não estão cá"))

    // Both devices apply the commit that removes them and, from then on, nothing.
    for (const sessaoExpulsa of [sessaoPortatil, sessaoTelemovel]) {
      let estado: GroupSession = sessaoExpulsa
      for (const commit of expulsao.commits) {
        const aplicado = await receive(estado, commit)
        estado = aplicado.session
      }
      const tentativa = await receive(estado, depois.ciphertext)
      expect(tentativa.kind).toBe("ignored")
    }
  })

  /**
   * The mutation, written as a test: removing ONE leaf doesn't remove the person.
   *
   * It's what happened to anyone who called `leafIndexOf` where they should have
   * called `leavesOf`: the kick looked done, the commit was valid, no one
   * saw any error, and the kicked person kept reading from their other device.
   * A flaw with no symptom on the side of whoever kicked them.
   */
  it("tirar só a primeira folha deixa a pessoa a ler pelo outro aparelho", async () => {
    const { alicePortatil, sessaoTelemovel, sessaoBruno } = await canalComDoisAparelhos()

    const soAPrimeira = leafIndexOf(sessaoBruno.state.ratchetTree, alicePortatil.address)
    expect(soAPrimeira).toBe(0)

    const meiaExpulsao = await removeMembers(sessaoBruno, [soAPrimeira as number])
    const depois = await encryptPayload(meiaExpulsao.session, text("julgava-te fora"))

    let telemovel: GroupSession = sessaoTelemovel
    for (const commit of meiaExpulsao.commits) {
      telemovel = (await receive(telemovel, commit)).session
    }

    // Still inside, still reading. That's the flaw, measured.
    expect(leavesOf(meiaExpulsao.session.state.ratchetTree, alicePortatil.address)).toEqual([1])
    const lido = await receive(telemovel, depois.ciphertext)
    expect(lido.kind).toBe("payload")
  })

  /**
   * Revoking ONE device is the opposite: it removes the machine and leaves the person.
   *
   * It's the operation a lost phone calls for, and it's the same machinery seen from
   * the other side: one leaf, one commit with UpdatePath, and the laptop keeps
   * reading. The honest caveat the interface has to repeat is in `device.revoke`: it cuts
   * reading from the next epoch on, and what the device already had, it keeps.
   */
  it("revogar um aparelho corta-lhe a epoch seguinte e deixa o outro a ler", async () => {
    const { alicePortatil, aliceTelemovel, sessaoPortatil, sessaoTelemovel, sessaoBruno } =
      await canalComDoisAparelhos()

    // The laptop revokes the phone: the phone's leaf is Alice's second.
    const arvore = sessaoPortatil.state.ratchetTree
    const folhasDaAlice = leavesOf(arvore, alicePortatil.address)
    const folhaDoTelemovel = folhasDaAlice.find(
      (folha) => memberAddresses(arvore).get(folha) === aliceTelemovel.address && folha !== 0,
    )
    expect(folhaDoTelemovel).toBe(1)

    const revogacao = await removeMembers(sessaoPortatil, [folhaDoTelemovel as number])
    const depois = await encryptPayload(revogacao.session, text("depois da revogação"))

    // The phone applies the commit that removes it and stops reading.
    let telemovel: GroupSession = sessaoTelemovel
    for (const commit of revogacao.commits) {
      telemovel = (await receive(telemovel, commit)).session
    }
    expect((await receive(telemovel, depois.ciphertext)).kind).toBe("ignored")

    // Bruno applies the same commit and keeps reading: the person didn't leave.
    let bruno: GroupSession = sessaoBruno
    for (const commit of revogacao.commits) {
      bruno = (await receive(bruno, commit)).session
    }
    expect((await receive(bruno, depois.ciphertext)).kind).toBe("payload")
    expect(leavesOf(bruno.state.ratchetTree, alicePortatil.address)).toEqual([0])
  })
})

/**
 * The chain of a key package, read BEFORE it's spent.
 *
 * `addressBindingAuthService` already refuses these leaves, but only inside
 * `createCommit`, after the package was claimed from the server, and it never comes
 * back. An inviter with a bundle in hand has to pick package by package, and
 * this is the function they pick with. Each test below breaks a different link.
 */
describe("credentialOfKeyPackage", () => {
  it("num pacote são devolve a cadeia: o endereço e o aparelho que assina a folha", async () => {
    const alice = generateIdentity(HOME)
    const [kp] = await generateKeyPackages(alice, 1)
    const cadeia = credentialOfKeyPackage(decodeKeyPackage((kp as { wire: Uint8Array }).wire))
    expect(cadeia?.address).toBe(alice.address)
    expect(cadeia?.accountKey).toEqual(alice.signingPublicKey)
    expect(cadeia?.deviceKey).toEqual(alice.deviceSigningPublicKey)
  })

  it("recusa a credencial de um aparelho colada numa folha assinada por outra chave (terceiro elo)", async () => {
    // The first two links close: the credential is from Alice's phone, whole and
    // properly signed by her account. What doesn't match is the leaf: it's the laptop's,
    // signed by the laptop's key. Without the third link this would pass and die inside
    // the commit, with the package already spent.
    const alicePortatil = generateIdentity(HOME)
    const aliceTelemovel = outroAparelho(alicePortatil)
    const [kpPortatil] = await generateKeyPackages(alicePortatil, 1)
    const pacote = decodeKeyPackage((kpPortatil as { wire: Uint8Array }).wire)
    const colado = {
      ...pacote,
      leafNode: {
        ...pacote.leafNode,
        credential: { credentialType: "basic" as const, identity: encodeDeviceCredential(aliceTelemovel.credential) },
      },
    }
    expect(credentialOfKeyPackage(colado)).toBeUndefined()
    // The untouched package still passes: only the pasting broke.
    expect(credentialOfKeyPackage(pacote)?.deviceKey).toEqual(alicePortatil.deviceSigningPublicKey)
  })

  it("recusa uma cadeia certificada por outra conta (segundo elo)", async () => {
    // The account address and key belong to Alice, the device key is the one
    // that signs the leaf, but the certificate was signed by Bruno. This is the server
    // (or anyone else) trying to slip a device into another person's account.
    const alice = generateIdentity(HOME)
    const bruno = generateIdentity(HOME)
    const [kp] = await generateKeyPackages(alice, 1)
    const pacote = decodeKeyPackage((kp as { wire: Uint8Array }).wire)
    const alheia = {
      ...pacote,
      leafNode: {
        ...pacote.leafNode,
        credential: {
          credentialType: "basic" as const,
          identity: encodeDeviceCredential({
            address: alice.address,
            accountKey: alice.signingPublicKey,
            deviceKey: alice.deviceSigningPublicKey,
            signature: signDeviceCert(bruno.signingPrivateKey, alice.deviceSigningPublicKey, alice.address),
          }),
        },
      },
    }
    expect(credentialOfKeyPackage(alheia)).toBeUndefined()
  })

  it("recusa um endereço que não é o resumo da chave de conta (primeiro elo)", async () => {
    const alice = generateIdentity(HOME)
    const bruno = generateIdentity(HOME)
    const [kp] = await generateKeyPackages(alice, 1)
    const pacote = decodeKeyPackage((kp as { wire: Uint8Array }).wire)
    const trocado = {
      ...pacote,
      leafNode: {
        ...pacote.leafNode,
        credential: {
          credentialType: "basic" as const,
          identity: encodeDeviceCredential({ ...alice.credential, address: bruno.address }),
        },
      },
    }
    expect(credentialOfKeyPackage(trocado)).toBeUndefined()
  })

  it("nunca lança: lixo na credencial devolve undefined", async () => {
    const alice = generateIdentity(HOME)
    const [kp] = await generateKeyPackages(alice, 1)
    const pacote = decodeKeyPackage((kp as { wire: Uint8Array }).wire)
    const lixo = { ...pacote, leafNode: { ...pacote.leafNode, credential: { credentialType: "basic" as const, identity: new Uint8Array([1, 2, 3]) } } }
    expect(credentialOfKeyPackage(lixo)).toBeUndefined()
    const vazio = { ...pacote, leafNode: { ...pacote.leafNode, credential: { credentialType: "basic" as const, identity: new Uint8Array(0) } } }
    expect(credentialOfKeyPackage(vazio)).toBeUndefined()
  })

  it("nunca lança: uma folha sem chave de assinatura, ou sem credencial, LANÇA lá dentro e sai undefined", async () => {
    // The entries above die in `decodeDeviceCredential`, which does not throw;
    // the `try` was never exercised. These do throw for real: `equalBytes` on
    // `undefined`, and `.credentialType` of `undefined`.
    const alice = generateIdentity(HOME)
    const [kp] = await generateKeyPackages(alice, 1)
    const pacote = decodeKeyPackage((kp as { wire: Uint8Array }).wire)
    const semChave = { ...pacote, leafNode: { ...pacote.leafNode, signaturePublicKey: undefined } } as unknown as typeof pacote
    expect(credentialOfKeyPackage(semChave)).toBeUndefined()
    const semCredencial = { ...pacote, leafNode: { ...pacote.leafNode, credential: undefined } } as unknown as typeof pacote
    expect(credentialOfKeyPackage(semCredencial)).toBeUndefined()
    const semFolha = { ...pacote, leafNode: undefined } as unknown as typeof pacote
    expect(credentialOfKeyPackage(semFolha)).toBeUndefined()
  })

  it("uma credencial que não é `basic` é recusada antes de se ler", async () => {
    const alice = generateIdentity(HOME)
    const [kp] = await generateKeyPackages(alice, 1)
    const pacote = decodeKeyPackage((kp as { wire: Uint8Array }).wire)
    const x509 = {
      ...pacote,
      leafNode: { ...pacote.leafNode, credential: { credentialType: "x509", certificates: [] } },
    } as unknown as typeof pacote
    expect(credentialOfKeyPackage(x509)).toBeUndefined()
  })
})
