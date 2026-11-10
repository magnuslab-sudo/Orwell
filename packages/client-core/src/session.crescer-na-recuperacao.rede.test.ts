import type { Payload } from "@enclave/protocol"
import { moradaDeSala } from "@enclave/protocol"
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest"
import {
  ate,
  contasDeTeste,
  desligarContas,
  levantarServidor,
  type ContaDeTeste,
  type ServidorDeTeste,
} from "../../../apps/server/testes/cliente-de-teste.js"

/**
 * Who joined while we were away, said once (11/3/2026).
 *
 * The owner's report: "login seems very slow". Measured in
 * `scripts/medir-login.mjs`: anyone who tidies a channel and comes back after N
 * joins said the entire cascade (profile, authority, rooms, roles, resend) N
 * times during recovery, and each send takes its turn in the group and writes
 * the vault before going out. With eight joins in the common room that was 67
 * sends in a row underneath the gate, plus one second on login. Once at the end
 * of recovery it says the same state, in the epoch that everyone who joined
 * decrypts.
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

/** The sends from this account to this channel, by type, from now on. */
function contarEnvios(conta: ContaDeTeste, canal: string): Map<string, number> {
  const contagem = new Map<string, number>()
  const original = conta.session.send.bind(conta.session)
  conta.session.send = async (channel: string, payload: Payload): Promise<void> => {
    if (channel === canal) contagem.set(payload.t, (contagem.get(payload.t) ?? 0) + 1)
    return original(channel, payload)
  }
  // Rooms, categories, and role assignments come out in batch (slow-after-join).
  const emLote = conta.session.sendBatch.bind(conta.session)
  conta.session.sendBatch = async (channel: string, payloads: readonly Payload[]): Promise<void> => {
    if (channel === canal) for (const payload of payloads) contagem.set(payload.t, (contagem.get(payload.t) ?? 0) + 1)
    return emLote(channel, payloads)
  }
  return contagem
}

describe("crescimentos na recuperação", () => {
  it("quem arruma o canal diz a quem entrou uma vez, no fim da recuperação, e não uma por entrada", async () => {
    const [ana, bruno, ...novos] = await contasDeTeste(servidor, ["Ana", "Bruno", "Carla", "Dora", "Eva"])
    abertas.push(ana!, bruno!, ...novos)
    const canal = moradaDeSala(servidor.casa)
    await ana!.session.createSpace(canal, undefined, "Clube")
    await ate(() => ana!.session.founderOf(canal) === ana!.address, "a Ana funda o canal")
    await ana!.session.seat(canal, bruno!.address)
    await ate(() => bruno!.session.channels.includes(canal), "o Bruno entra")
    await ate(() => bruno!.session.roomsOf(canal).length > 0, "o Bruno conhece as salas")

    // Ana leaves; Bruno adds the other three, one commit each.
    ana!.session.disconnect()
    for (const novo of novos) {
      await bruno!.session.seat(canal, novo.address)
      await ate(() => novo.session.channels.includes(canal), `${novo.nome} entra`)
    }

    // Ana comes back: recovery goes through all three growth steps.
    const envios = contarEnvios(ana!, canal)
    await ana!.session.connect()
    await ate(() => ana!.session.membersOf(canal).length === 5, "a Ana vê os cinco", 30_000)
    // The cascade fires at the end of recovery: wait for it, and for nothing else.
    await ate(() => (envios.get("profile") ?? 0) >= 2, "o perfil da Ana sai na ligação e na cascata", 15_000)
    await new Promise((resolve) => setTimeout(resolve, 2_000))

    /*
      Two rounds: one for each connection (the handshake publishes the profile
      and repairs the rooms of restored channels) and the cascade, once, at the
      end of recovery. Before this fix there were four: one for the connection
      and one per entry (4 profiles and 12 `channel.meta`).
    */
    expect(envios.get("profile")).toBe(2)
    const salas = ana!.session.roomsOf(canal).length
    expect(salas).toBeGreaterThan(0)
    expect(envios.get("channel.meta") ?? 0).toBe(2 * salas)

    // And whoever joined learns: Ana's name and the rooms of the channel.
    for (const novo of novos) {
      await ate(
        () => novo.vault.contents.directory[ana!.address]?.payload["displayName"] === "Ana",
        `${novo.nome} sabe o nome da Ana`,
        15_000,
      )
      await ate(() => novo.session.roomsOf(canal).length === ana!.session.roomsOf(canal).length, `${novo.nome} vê as salas`, 15_000)
    }
  }, 90_000)
})
