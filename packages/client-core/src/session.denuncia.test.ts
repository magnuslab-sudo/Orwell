import { moradaDeSala, toBase64 } from "@enclave/protocol"
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest"
// The harness server, for real, on an ephemeral port. The sessions are from this
// package (`./session.js`): this task's code is what gets measured.
import { ate, CofreEmMemoria, levantarServidor, type ServidorDeTeste } from "../../../apps/server/testes/cliente-de-teste.js"
import { Session } from "./session.js"
import { Vault } from "./vault.js"

/**
 * `Session.prepararDenuncia` with real sessions (Task 3 of reports).
 *
 * Ana founds a channel and seats Bia. Bia writes; Ana reports. Bia's item
 * carries the leaf chain from her tree (the account key and her device
 * certificate), the authorship her device put on it, and `denunciada` points
 * to it.
 */

let servidor: ServidorDeTeste
const abertas: Session[] = []

async function conta(nome: string): Promise<Session> {
  const vault = new Vault(new CofreEmMemoria())
  await vault.create("frase-passe-de-teste")
  const session = new Session(vault)
  await session.createIdentity(servidor.casa)
  await session.connect()
  await session.updateProfile({ displayName: nome, donations: [] })
  abertas.push(session)
  return session
}

function mensagensDe(session: Session, canal: string, autor: string): { id: string; body: string }[] {
  return session
    .history(canal)
    .filter((e) => e.sender === autor && e.payload.t === "message")
    .map((e) => e.payload as unknown as { id: string; body: string })
}

beforeAll(async () => {
  servidor = await levantarServidor()
}, 30_000)
afterAll(async () => {
  await servidor?.fechar()
})
afterEach(() => {
  for (const s of abertas.splice(0)) s.disconnect()
})

describe("prepararDenuncia, com sessões a sério", () => {
  it("devolve a cadeia k/x de quem tem folha na árvore e a denunciada certa", async () => {
    const ana = await conta("Ana")
    const bia = await conta("Bia")
    const canal = moradaDeSala(servidor.casa)
    await ana.createSpaceChannel(canal)
    await ate(() => ana.founderOf(canal) === ana.identity.address, "a Ana funda o canal")
    await ana.seat(canal, bia.identity.address)
    await ate(() => bia.channels.includes(canal), "a Bia entra no canal")

    await ana.send(canal, { t: "message", id: crypto.randomUUID(), sentAt: Date.now(), body: "bom dia", attachments: [], links: [], mentions: [] } as never)
    await ate(() => mensagensDe(bia, canal, ana.identity.address).length === 1, "a Bia recebe a da Ana")
    for (const body of ["primeira", "a ofensa", "terceira"]) {
      await bia.send(canal, { t: "message", id: crypto.randomUUID(), sentAt: Date.now(), body, attachments: [], links: [], mentions: [] } as never)
    }
    await ate(() => mensagensDe(ana, canal, bia.identity.address).length === 3, "a Ana recebe as três da Bia")
    const ofensa = mensagensDe(ana, canal, bia.identity.address).find((m) => m.body === "a ofensa")!

    const preparada = await ana.prepararDenuncia({ canal, pessoa: bia.identity.address, mensagem: { id: ofensa.id } })
    expect(preparada.itens.map((i) => i.texto)).toEqual(["bom dia", "primeira", "a ofensa", "terceira"])
    expect(preparada.denunciada).toBe(2)
    expect(preparada.itens[2]!.denunciada).toBe(true)
    expect(preparada.temCopia).toBe(false)
    expect(preparada.denunciado).toBe(bia.identity.address)

    const credencial = bia.identity.credential
    for (const item of preparada.itens.filter((i) => i.autor === bia.identity.address)) {
      expect(item.item.k).toBe(toBase64(credencial.accountKey))
      expect(item.item.x).toBe(toBase64(credencial.signature))
      expect((item.item.p["autoria"] as { ap: string }).ap).toBe(toBase64(bia.identity.deviceSigningPublicKey))
    }
    const daAna = preparada.itens.find((i) => i.autor === ana.identity.address)!
    expect(daAna.item.k).toBe(toBase64(ana.identity.credential.accountKey))

    // The founder's copy lacks Ana's, who reports it.
    expect(preparada.itensDoFundador.map((i) => i.texto)).toEqual(["primeira", "a ofensa", "terceira"])

    // Mine does not report itself; one that does not exist does not either.
    const minha = mensagensDe(ana, canal, ana.identity.address)[0]!
    await expect(ana.prepararDenuncia({ canal, pessoa: ana.identity.address, mensagem: { id: minha.id } })).rejects.toThrow(
      "this message cannot be reported",
    )
    await expect(ana.prepararDenuncia({ canal, pessoa: bia.identity.address, mensagem: { id: "nao-existe-000" } })).rejects.toThrow(
      "this message cannot be reported",
    )

    // The person, without a message: her latest in this conversation.
    const pessoa = await ana.prepararDenuncia({ canal, pessoa: bia.identity.address })
    expect(pessoa.itens.map((i) => i.texto)).toEqual(["primeira", "a ofensa", "terceira"])
    expect(pessoa.denunciada).toBe(-1)
  }, 120_000)
})
