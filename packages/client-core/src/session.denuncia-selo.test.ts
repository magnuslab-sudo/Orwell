import { readdirSync } from "node:fs"
import { dirname, join } from "node:path"
import { moradaDeSala } from "@enclave/protocol"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import { ate, CofreEmMemoria, levantarServidor, type ServidorDeTeste } from "../../../apps/server/testes/cliente-de-teste.js"
import { origemDoServidorDe } from "./relato.js"
import { Session } from "./session.js"
import { Vault } from "./vault.js"

/**
 * An unsealed copy falls on its own, and the report follows (decision R21).
 * The seal fails here on purpose (`selarCopia` throws), with a real server and
 * real sessions: Ana founds, Bia writes, Carla reports.
 */
vi.mock("./denuncia.js", async (original) => ({
  ...(await original<typeof import("./denuncia.js")>()),
  selarCopia: () => {
    throw new Error("degenerate shared secret")
  },
}))

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

beforeAll(async () => {
  servidor = await levantarServidor()
}, 30_000)
afterAll(async () => {
  for (const s of abertas.splice(0)) s.disconnect()
  await servidor?.fechar()
})

describe("denunciar, quando o selo falha", () => {
  it("a denúncia chega ao servidor sem cópia", async () => {
    const [ana, bia, carla] = [await conta("Ana"), await conta("Bia"), await conta("Carla")]
    const canal = moradaDeSala(servidor.casa)
    await ana.createSpaceChannel(canal)
    await ate(() => ana.founderOf(canal) === ana.identity.address, "a Ana funda o canal")
    for (const s of [bia, carla]) {
      await ana.seat(canal, s.identity.address)
      await ate(() => s.channels.includes(canal), "entra no canal")
    }
    const id = crypto.randomUUID()
    await bia.send(canal, { t: "message", id, sentAt: Date.now(), body: "a ofensa", attachments: [], links: [], mentions: [] } as never)
    await ate(() => carla.history(canal).some((e) => e.payload["id"] === id), "a Carla recebe a da Bia")

    const origem = origemDoServidorDe(carla.identity.address)
    const preparada = await carla.prepararDenuncia({ canal, pessoa: bia.identity.address, mensagem: { id } }, origem)
    expect(preparada.temCopia).toBe(true)
    await expect(carla.denunciar(preparada, { motivo: 3, nota: "Insultos.", boaFe: true }, origem, "1.2.0")).resolves.toEqual({ ok: true })

    const pasta = join(dirname(servidor.baseDeDados), "denuncias")
    expect(readdirSync(pasta).filter((nome) => /^\d+\.json$/.test(nome)).length).toBe(1)
    expect(readdirSync(pasta).includes("caixa")).toBe(false)
  }, 60_000)
})
