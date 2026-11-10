import { generateIdentity, parseServerName } from "@enclave/protocol"
import { createCommit, createProposal, encodeMlsMessage, makePskIndex } from "ts-mls"
import { describe, expect, it } from "vitest"
import { addMembers, createChannel, exportSession, generateKeyPackages, importSession, joinChannel, receive, removeMembers } from "./group.js"
import { leavesOf } from "./sender.js"

/**
 * **Whoever is removed from a group learns about it** (F7, audit of 20/10/2026).
 *
 * ts-mls does not apply a commit that removes the leaf of whoever processes it:
 * the UpdatePath comes encrypted for whoever stays, and processing fails before
 * reaching `removedFromGroup`. `receive` now recognizes the case, using epoch proofs,
 * and returns the group marked.
 */
const CASA = parseServerName("localhost:8448")
const CANAL = "!lagar:localhost:8448"

async function doisNoCanal() {
  const ana = generateIdentity(CASA)
  const bruno = generateIdentity(CASA)
  let grupoAna = await createChannel(ana, CANAL)
  const [pacote] = await generateKeyPackages(bruno, 1)
  if (!pacote) throw new Error("sem pacote")
  const convite = await addMembers(grupoAna, [pacote.publicPackage])
  grupoAna = convite.session
  const grupoBruno = await joinChannel(CANAL, convite.welcome, pacote.publicPackage, pacote.privatePackage)
  return { ana, bruno, grupoAna, grupoBruno }
}

describe("a remoção da nossa folha", () => {
  it("é reconhecida, marcada no grupo, e a marca sobrevive a gravar e ler", async () => {
    const { bruno, grupoAna, grupoBruno } = await doisNoCanal()
    const remocao = await removeMembers(grupoAna, leavesOf(grupoAna.state.ratchetTree, bruno.address))
    const [commit] = remocao.commits
    if (!commit) throw new Error("sem commit")
    const visto = await receive(grupoBruno, commit)
    expect(visto.kind).toBe("ignored")
    expect(visto.session.state.groupActiveState.kind).toBe("removedFromGroup")
    const relido = await importSession(CANAL, exportSession(visto.session))
    expect(relido.state.groupActiveState.kind).toBe("removedFromGroup")
  })

  it("um commit que tira OUTRA pessoa não marca quem fica", async () => {
    const { ana, grupoAna, grupoBruno } = await doisNoCanal()
    const carlos = generateIdentity(CASA)
    const [pacote] = await generateKeyPackages(carlos, 1)
    if (!pacote) throw new Error("sem pacote")
    const entrada = await addMembers(grupoAna, [pacote.publicPackage])
    const doBruno = await receive(grupoBruno, entrada.commit)
    expect(doBruno.kind).toBe("epoch")
    const remocao = await removeMembers(entrada.session, leavesOf(entrada.session.state.ratchetTree, carlos.address))
    const [commit] = remocao.commits
    if (!commit) throw new Error("sem commit")
    const visto = await receive(doBruno.session, commit)
    expect(visto.kind).toBe("epoch")
    expect(visto.session.state.groupActiveState.kind).toBe("active")
    expect(ana.address).not.toBe(carlos.address)
  })

  /*
    The negative cases (M6 of the review): none of these can mark the group as
    left, because marking it is dropping the channel. A commit from another epoch,
    corrupted bytes (the server inventing a removal), and a removal by reference,
    which cannot be read without resolving stored proposals: whoever receives it
    stays "active", and keeps the old behavior.
  */
  it("um commit de outra epoch não marca", async () => {
    const { bruno, grupoAna, grupoBruno } = await doisNoCanal()
    const carlos = generateIdentity(CASA)
    const [pacote] = await generateKeyPackages(carlos, 1)
    if (!pacote) throw new Error("sem pacote")
    // Ana spends one epoch with Bruno not seeing, and removes him in that new epoch.
    const entrada = await addMembers(grupoAna, [pacote.publicPackage])
    const remocao = await removeMembers(entrada.session, leavesOf(entrada.session.state.ratchetTree, bruno.address))
    const [commit] = remocao.commits
    if (!commit) throw new Error("sem commit")
    const visto = await receive(grupoBruno, commit)
    expect(visto.kind).toBe("ignored")
    expect(visto.session.state.groupActiveState.kind).toBe("active")
  })

  it("bytes adulterados não marcam", async () => {
    const { bruno, grupoAna, grupoBruno } = await doisNoCanal()
    const remocao = await removeMembers(grupoAna, leavesOf(grupoAna.state.ratchetTree, bruno.address))
    const [commit] = remocao.commits
    if (!commit) throw new Error("sem commit")
    const adulterado = new Uint8Array(commit)
    const indice = adulterado.length - 5
    adulterado[indice] = (adulterado[indice] ?? 0) ^ 0xff
    const visto = await receive(grupoBruno, adulterado)
    expect(visto.session.state.groupActiveState.kind).toBe("active")
  })

  it("uma remoção por referência não marca", async () => {
    const { bruno, grupoAna, grupoBruno } = await doisNoCanal()
    const folha = leavesOf(grupoAna.state.ratchetTree, bruno.address)[0]
    if (folha === undefined) throw new Error("sem folha")
    const proposta = await createProposal(grupoAna.state, false, { proposalType: "remove", remove: { removed: folha } }, grupoAna.suite)
    const doBruno = await receive(grupoBruno, encodeMlsMessage(proposta.message))
    const commit = await createCommit(
      { state: proposta.newState, cipherSuite: grupoAna.suite, pskIndex: makePskIndex(proposta.newState, {}) },
      { ratchetTreeExtension: true },
    )
    const visto = await receive(doBruno.session, encodeMlsMessage(commit.commit))
    expect(visto.session.state.groupActiveState.kind).toBe("active")
  })
})
