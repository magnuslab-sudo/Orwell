import { EXTENSAO_RETRATO, generateIdentity, parseServerName } from "@enclave/protocol"
import { createCommit, emptyPskIndex, joinGroupWithExtensions, makePskIndex } from "ts-mls"
import { describe, expect, it } from "vitest"
import {
  addMembers,
  createChannel,
  generateKeyPackages,
  joinChannel,
  joinChannelComExtensoes,
  joinChannelExternally,
  publishableGroupInfo,
  receive,
  removeMembers,
  retratoDasExtensoes,
  rotateEpoch,
  type GroupSession,
} from "./group.js"
import { memberAddresses } from "./sender.js"
import { addressBindingAuthService, enclaveClientConfig } from "./suite.js"
import { validateRatchetTree } from "ts-mls/clientState.js"

const HOME = parseServerName("enclave.test")
const CANAL = "!984:enclave.test"

async function pacoteDe(identidade: ReturnType<typeof generateIdentity>) {
  const [pacote] = await generateKeyPackages(identidade, 1)
  if (!pacote) throw new Error("sem key package")
  return pacote
}

const membros = (sessao: GroupSession): number => new Set(memberAddresses(sessao.state.ratchetTree).values()).size

/**
 * The shared room that stopped accepting new people (report from 2/11/2026).
 *
 * The production tree had a member added without a path (leaf in `unmerged_leaves`
 * of a parent node) below a node that another member had already updated with a
 * path (empty list). It is a valid tree by RFC 9420 (§7.9.2: only nodes BETWEEN
 * the leaf and its parent need to list it). The `validateRatchetTree` in ts-mls 1.6.2
 * required the list to be IDENTICAL in all nodes along the entire path, and rejected it
 * with "non-blank intermediate node must list leaf node in its unmerged_leaves".
 * Whoever was there never revalidates the tree; whoever arrived failed the Welcome
 * and the card, silently. See `patches/ts-mls+1.6.2.patch`.
 *
 * The shape, in a four-leaf tree: C updates (nodes 5 and 3), A adds D (nodes 5 and 3 now
 * list leaf 3), A updates (node 3 goes back to []). Leaf 3 stays in node 5, with
 * node 3 above it not listing it.
 */
const desenho = (s: GroupSession): string =>
  s.state.ratchetTree.map((n, i) => (n?.nodeType === "parent" ? `${i}:[${n.parent.unmergedLeaves}]` : n ? `${i}:f` : `${i}:-`)).join(" ")
const ver = (passo: string, s: GroupSession): void => {
  if (process.env.ARVORE) console.log(`${passo}: ${desenho(s)}`)
}

async function salaComAFormaDeProducao() {
  const [a, b, c, d, e, f] = Array.from({ length: 6 }, () => generateIdentity(HOME))
  if (!a || !b || !c || !d || !e || !f) throw new Error("sem identidades")

  // Five leaves (0 to 4) in a tree of eight: A, B, C, D, and E.
  let sala = await createChannel(a, CANAL)
  const pacoteDoE = await pacoteDe(e)
  const comTodos = await addMembers(sala, [
    (await pacoteDe(b)).publicPackage,
    (await pacoteDe(c)).publicPackage,
    (await pacoteDe(d)).publicPackage,
    pacoteDoE.publicPackage,
  ])
  sala = comTodos.session
  let salaDoE = await joinChannel(CANAL, comTodos.welcome, pacoteDoE.publicPackage, pacoteDoE.privatePackage)
  ver("cinco", sala)

  // A removes D (leaf 3), with path: nodes 3 and 7 get updated, with [].
  const semD = await removeMembers(sala, [3])
  sala = semD.session
  salaDoE = await aplicar(salaDoE, semD.commits[0]!)
  ver("sem D", sala)

  // A adds F, without path: goes to leaf 3, and nodes 3 and 7 now list it.
  const comF = await addMembers(sala, [(await pacoteDe(f)).publicPackage])
  sala = comF.session
  salaDoE = await aplicar(salaDoE, comF.commit)
  ver("com F", sala)

  // E updates from the other side of the tree: only the root (7) is in its path, and goes back to [].
  const renovacaoDoE = await rotateEpoch(salaDoE)
  sala = await aplicar(sala, renovacaoDoE.commits[0]!)
  ver("E renova", sala)

  const no3 = sala.state.ratchetTree[3]
  const raiz = sala.state.ratchetTree[7]
  // The shape we want, no other: if the library changes this, the test says so.
  expect(no3?.nodeType === "parent" && no3.parent.unmergedLeaves).toEqual([3])
  expect(raiz?.nodeType === "parent" && raiz.parent.unmergedLeaves).toEqual([])
  return sala
}

async function aplicar(sessao: GroupSession, commit: Uint8Array): Promise<GroupSession> {
  const r = await receive(sessao, commit)
  if (r.kind !== "epoch") throw new Error(`commit não entrou: ${r.kind}`)
  return r.session
}

describe("árvore com folhas por fundir em níveis diferentes", () => {
  it("quem chega entra por Welcome", async () => {
    const sala = await salaComAFormaDeProducao()
    const novo = generateIdentity(HOME)
    const pacote = await pacoteDe(novo)
    const entrada = await addMembers(sala, [pacote.publicPackage])
    const lugar = await joinChannel(CANAL, entrada.welcome, pacote.publicPackage, pacote.privatePackage)
    expect(membros(lugar)).toBe(6)
  })

  it("e entra pelo cartão da sala comum", async () => {
    const sala = await salaComAFormaDeProducao()
    const novo = generateIdentity(HOME)
    const pacote = await pacoteDe(novo)
    const entrada = await joinChannelExternally(CANAL, await publishableGroupInfo(sala), pacote.publicPackage, pacote.privatePackage)
    expect(membros(entrada.session)).toBe(6)
  })
})

/**
 * The patch only places the rule where RFC 9420 §12.4.3.1 says; it does not open anything else.
 * Each tree here is the one above with ONE change, and what the RFC forbids stays
 * refused, before the tree hash, by the rule's own message.
 */
describe("o que o RFC proíbe continua recusado", () => {
  type Arvore = GroupSession["state"]["ratchetTree"]
  const validar = (sala: GroupSession, arvore: Arvore) =>
    validateRatchetTree(
      arvore,
      sala.state.groupContext,
      enclaveClientConfig().lifetimeConfig,
      addressBindingAuthService,
      sala.state.groupContext.treeHash,
      sala.suite,
    )
  /** A copy of the tree with the `unmerged_leaves` list of node `no` swapped. */
  const comLista = (arvore: Arvore, no: number, lista: number[]): Arvore =>
    arvore.map((n, i) => (i === no && n?.nodeType === "parent" ? { ...n, parent: { ...n.parent, unmergedLeaves: lista } } : n)) as Arvore

  it("a árvore intacta passa", async () => {
    const sala = await salaComAFormaDeProducao()
    expect(await validar(sala, sala.state.ratchetTree)).toBeUndefined()
  })

  it("uma folha listada num nó de que não é descendente", async () => {
    const sala = await salaComAFormaDeProducao()
    // Leaf 4 (E) is on the right half; node 3 covers leaves 0 to 3.
    const erro = await validar(sala, comLista(sala.state.ratchetTree, 3, [3, 4]))
    expect(erro?.message).toBe("Unmerged leaf did not represent a non-blank descendant leaf node")
  })

  it("uma folha vazia listada como por fundir", async () => {
    const sala = await salaComAFormaDeProducao()
    // Leaf 5 is descended from the root, but it is empty. ts-mls 1.6.2 let this pass.
    const erro = await validar(sala, comLista(sala.state.ratchetTree, 7, [5]))
    expect(erro?.message).toBe("Unmerged leaf did not represent a non-blank descendant leaf node")
  })

  it("um nó intermédio entre a folha e o pai que a lista, sem a listar", async () => {
    const sala = await salaComAFormaDeProducao()
    // The root lists leaf 2 (C); between it and the root is node 3, which does not list it.
    const erro = await validar(sala, comLista(sala.state.ratchetTree, 7, [2]))
    expect(erro?.message).toBe("non-blank intermediate node must list leaf node in its unmerged_leaves")
  })

  it("um hash de pai trocado", async () => {
    const sala = await salaComAFormaDeProducao()
    const arvore = sala.state.ratchetTree.map((n, i) => {
      if (i !== 1 || n?.nodeType !== "parent") return n
      const hash = new Uint8Array(n.parent.parentHash)
      hash[0] = (hash[0] ?? 0) ^ 0xff
      return { ...n, parent: { ...n.parent, parentHash: hash } }
    }) as Arvore
    const erro = await validar(sala, arvore)
    expect(erro?.message).toBe("Unable to verify parent hash")
  })
})

/**
 * The entry with the channel portrait (phase 1 of 1.1) uses `joinGroupWithExtensions`,
 * and must go through the SAME patched validation. ts-mls 1.6.2's `joinGroup` is a
 * wrapper around it, so the patch in `patches/ts-mls+1.6.2.patch` applies to both;
 * this proves it by behavior, not by reading code.
 */
describe("a entrada com o retrato passa pela mesma validação da árvore", () => {
  const RETRATO = new TextEncoder().encode(JSON.stringify({ v: 1, canal: CANAL, itens: [], geradoEm: 1 }))

  it("quem chega entra por Welcome com o retrato, na árvore com a forma de produção", async () => {
    const sala = await salaComAFormaDeProducao()
    const novo = generateIdentity(HOME)
    const pacote = await pacoteDe(novo)
    const entrada = await addMembers(sala, [pacote.publicPackage], { retrato: RETRATO })
    const { session, extensoes } = await joinChannelComExtensoes(CANAL, entrada.welcome, pacote.publicPackage, pacote.privatePackage)
    expect(membros(session)).toBe(6)
    expect(retratoDasExtensoes(extensoes)).toEqual(RETRATO)
  })

  it("e uma árvore que o RFC proíbe é recusada por joinGroupWithExtensions, pela regra do remendo", async () => {
    const sala = await salaComAFormaDeProducao()
    const novo = generateIdentity(HOME)
    const pacote = await pacoteDe(novo)
    // The tree goes separately (without the `ratchet_tree` extension), so a modified tree can be delivered.
    const resultado = await createCommit(
      { state: sala.state, cipherSuite: sala.suite, pskIndex: makePskIndex(sala.state, {}) },
      {
        extraProposals: [{ proposalType: "add", add: { keyPackage: pacote.publicPackage } }],
        ratchetTreeExtension: false,
        groupInfoExtensions: [{ extensionType: EXTENSAO_RETRATO, extensionData: RETRATO }],
      },
    )
    const arvore = resultado.newState.ratchetTree
    const entrar = (comArvore: typeof arvore) =>
      joinGroupWithExtensions(
        resultado.welcome!,
        pacote.publicPackage,
        pacote.privatePackage,
        emptyPskIndex,
        sala.suite,
        comArvore,
        undefined,
        enclaveClientConfig(),
      )
    // The real tree (the production one, which unpatched ts-mls refused) opens, with the portrait.
    const [, extensoes] = await entrar(arvore)
    expect(retratoDasExtensoes(extensoes)).toEqual(RETRATO)
    // The root listing leaf 2 (C), with node 3 in between not listing it: the RFC forbids this.
    const mexida = arvore.map((n, i) => (i === 7 && n?.nodeType === "parent" ? { ...n, parent: { ...n.parent, unmergedLeaves: [2] } } : n)) as typeof arvore
    await expect(entrar(mexida)).rejects.toThrow("non-blank intermediate node must list leaf node in its unmerged_leaves")
  })
})
