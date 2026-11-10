import { generateIdentity, parseServerName, type Payload } from "@enclave/protocol"
import { describe, expect, it } from "vitest"
import { addMembers, createChannel, encryptPayload, generateKeyPackages, joinChannel, receive, removeMembers } from "./group.js"
import { leavesOf } from "./sender.js"

/**
 * Who wrote a message from an epoch that already left (3/11/2026, Orwell channel).
 *
 * `receive` opens a message from an earlier epoch through the history window, using
 * that epoch's tree, and read the sender in today's tree. In `!984`, with
 * updates and additions every few minutes, the leaf of who wrote can be empty
 * (was removed) or already belong to someone else (MLS gives the empty leftmost
 * leaf to whoever joins). In the first case the message was lost (opened,
 * but "without credential", and counted as `epoch-skipped`); in the second it was
 * assigned to the wrong person, and authority checks (`role.assign`,
 * `fixar`, overlays) judged the wrong person.
 */
const CASA = parseServerName("localhost:8448")
const CANAL = "!984:localhost:8448"

function texto(body: string): Payload {
  return { t: "message", id: crypto.randomUUID(), sentAt: Date.now(), body, attachments: [], links: [], mentions: [] } as Payload
}

async function tresNoCanal() {
  const ana = generateIdentity(CASA)
  const bruno = generateIdentity(CASA)
  const carla = generateIdentity(CASA)
  const [pb] = await generateKeyPackages(bruno, 1)
  const [pc] = await generateKeyPackages(carla, 1)
  if (!pb || !pc) throw new Error("sem pacotes")
  const entrada = await addMembers(await createChannel(ana, CANAL), [pb.publicPackage, pc.publicPackage])
  const grupoBruno = await joinChannel(CANAL, entrada.welcome, pb.publicPackage, pb.privatePackage)
  const grupoCarla = await joinChannel(CANAL, entrada.welcome, pc.publicPackage, pc.privatePackage)
  return { ana, bruno, carla, grupoAna: entrada.session, grupoBruno, grupoCarla }
}

describe("o remetente de uma mensagem de uma epoch anterior", () => {
  it("é quem a escreveu, mesmo que a folha dele tenha ficado vazia", async () => {
    const { bruno, grupoAna, grupoBruno, grupoCarla } = await tresNoCanal()
    const doBruno = await encryptPayload(grupoBruno, texto("antes de sair"))
    // Ana removes Bruno; Carla reads the commit before Bruno's message.
    const remocao = await removeMembers(grupoAna, leavesOf(grupoAna.state.ratchetTree, bruno.address))
    const [commit] = remocao.commits
    if (!commit) throw new Error("sem commit")
    const visto = await receive(grupoCarla, commit)
    expect(visto.kind).toBe("epoch")

    const lida = await receive(visto.session, doBruno.ciphertext)
    expect(lida.kind).toBe("payload")
    if (lida.kind === "payload") expect(lida.sender).toBe(bruno.address)
  })

  it("é quem a escreveu, e não quem entrou depois para a mesma folha", async () => {
    const { bruno, grupoAna, grupoBruno, grupoCarla } = await tresNoCanal()
    const folhaDoBruno = leavesOf(grupoAna.state.ratchetTree, bruno.address)
    const doBruno = await encryptPayload(grupoBruno, texto("antes de sair"))
    const remocao = await removeMembers(grupoAna, folhaDoBruno)
    const [commitRemocao] = remocao.commits
    if (!commitRemocao) throw new Error("sem commit")
    // Dora joins next and gets the leaf that Bruno left.
    const dora = generateIdentity(CASA)
    const [pd] = await generateKeyPackages(dora, 1)
    if (!pd) throw new Error("sem pacote")
    const entrada = await addMembers(remocao.session, [pd.publicPackage])
    expect(leavesOf(entrada.session.state.ratchetTree, dora.address)).toEqual(folhaDoBruno)

    const depoisDaRemocao = await receive(grupoCarla, commitRemocao)
    const depoisDaEntrada = await receive(depoisDaRemocao.session, entrada.commit)
    expect(depoisDaEntrada.kind).toBe("epoch")

    const lida = await receive(depoisDaEntrada.session, doBruno.ciphertext)
    // Outside the history window it does not open, and that is persistent secrecy; once open, it is from Bruno.
    if (lida.kind === "payload") expect(lida.sender).toBe(bruno.address)
    else expect(lida.kind).toBe("payload")
  })
})
