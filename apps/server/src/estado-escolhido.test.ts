import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest"
import {
  ate,
  canalComTodos,
  contasDeTeste,
  desligarContas,
  levantarServidor,
  type ContaDeTeste,
  type ServidorDeTeste,
} from "../testes/cliente-de-teste.js"

/**
 * Phase 1h: the chosen state (busy, away) reaches the others.
 *
 * The interface published `activity` on the profile and read it from the others'
 * directory entries, and the schema accepted it. But the core discarded it when
 * building the `profile` payload (`#payloadDoPerfil`), and the web bridge did
 * not even pass it on: "busy" only showed on one's own device.
 */

let servidor: ServidorDeTeste
const abertas: ContaDeTeste[] = []

beforeAll(async () => {
  servidor = await levantarServidor()
}, 30_000)

afterEach(() => {
  desligarContas(abertas.splice(0))
})

afterAll(async () => {
  await servidor?.fechar()
})

type PerfilComEstado = Parameters<ContaDeTeste["session"]["updateProfile"]>[0] & { activity?: string }

const estadoDe = (quemLe: ContaDeTeste, quem: ContaDeTeste): unknown => quemLe.session.directorySnapshot()[quem.address]?.payload["activity"]

describe("o estado escolhido chega aos outros", () => {
  it("a Ana põe «ocupado», e o Bruno lê-o; depois «ausente»; depois «online», que é sem estado", async () => {
    const [ana, bruno] = await contasDeTeste(servidor, ["Ana", "Bruno"])
    abertas.push(ana!, bruno!)
    await canalComTodos(servidor, ana!, [bruno!])

    const pôr = (activity: string | undefined): Promise<void> =>
      ana!.session.updateProfile({ displayName: "Ana", donations: [], ...(activity ? { activity } : {}) } as PerfilComEstado)

    await pôr("ocupado")
    await ate(() => estadoDe(bruno!, ana!) === "ocupado", "o Bruno lê «ocupado»")
    await pôr("ausente")
    await ate(() => estadoDe(bruno!, ana!) === "ausente", "o Bruno lê «ausente»")
    await pôr(undefined)
    await ate(() => bruno!.session.directorySnapshot()[ana!.address]?.payload["displayName"] === "Ana" && estadoDe(bruno!, ana!) === undefined, "o Bruno volta a ler online")
    // The profile itself stores the choice.
    expect((ana!.session.profile as { activity?: string }).activity).toBeUndefined()
  }, 120_000)

  it("«invisível» não se publica como estado: o perfil sai sem ele", async () => {
    const [ana, bruno] = await contasDeTeste(servidor, ["Ana", "Bruno"])
    abertas.push(ana!, bruno!)
    await canalComTodos(servidor, ana!, [bruno!])
    await ana!.session.updateProfile({ displayName: "Ana", donations: [], activity: "ocupado" } as PerfilComEstado)
    await ate(() => estadoDe(bruno!, ana!) === "ocupado", "o Bruno lê «ocupado»")
    await ana!.session.updateProfile({ displayName: "Ana Maria", donations: [], activity: "invisivel" } as PerfilComEstado)
    await ate(() => bruno!.session.directorySnapshot()[ana!.address]?.payload["displayName"] === "Ana Maria", "o perfil novo chega")
    expect(estadoDe(bruno!, ana!)).toBeUndefined()
  }, 120_000)
})
