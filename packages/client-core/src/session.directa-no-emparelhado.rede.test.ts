import { moradaDeSala } from "@enclave/protocol"
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest"
import type { FichaDoCanal } from "./tipoDoCanal.js"
// The harness server's server, for real, on an ephemeral port.
import {
  ate,
  contasDeTeste,
  desligarContas,
  emparelharAparelho,
  levantarServidor,
  type ContaDeTeste,
  type ServidorDeTeste,
} from "../../../apps/server/testes/cliente-de-teste.js"

/**
 * A private conversation on a paired device, with the main device offline
 * (owner report, 2/11/2026: "there are users whose private messages are in
 * the 'communities' tab instead of 'friends'").
 *
 * Only the device with the account key deduces a direct (the address comes
 * from the DH of the two account keys). The paired device receives the token
 * through the account channel when the main one recognizes it. With the main
 * offline, a new direct was a room on the paired device, and stayed in
 * "Communities" until the main came back. Someone who created the account in a
 * browser and uses the paired computer never saw it come back.
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

async function contas(...nomes: string[]): Promise<ContaDeTeste[]> {
  const novas = await contasDeTeste(servidor, nomes)
  abertas.push(...novas)
  return novas
}

/** The tokens the interface read in the last `channels` event: this is what it draws. */
function fichasDaInterface(conta: ContaDeTeste): () => Record<string, FichaDoCanal> {
  let vistas: Record<string, FichaDoCanal> = conta.session.fichasDosCanais()
  conta.session.on("channels", () => {
    vistas = conta.session.fichasDosCanais()
  })
  return () => vistas
}

const espera = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

describe("a directa num aparelho emparelhado sem o principal", () => {
  it("é uma directa logo, sem o principal; a ficha do principal fica no cofre quando ele volta", async () => {
    const [ana, carla] = await contas("Ana", "Carla")
    const telemovel = await emparelharAparelho(ana!)
    abertas.push(telemovel)
    const interface_ = fichasDaInterface(telemovel)
    ana!.session.disconnect()

    const dm = await carla!.session.openDirect(ana!.address)
    await ate(() => telemovel.session.channels.includes(dm), "o telemóvel entra na directa", 30_000)
    await ate(() => interface_()[dm]?.tipo === "directa", "a interface do telemóvel vê uma directa", 15_000)
    expect(interface_()[dm]).toEqual({ tipo: "directa", par: carla!.address })
    expect(telemovel.session.tipoDoCanal(dm)).toBe("directa")
    // Temporary: does not go to the vault, nor to siblings. The main's is the one that stays.
    expect(telemovel.vault.contents.fichasDosCanais?.[dm]).toBeUndefined()

    await ana!.session.connect()
    await ate(() => telemovel.vault.contents.fichasDosCanais?.[dm]?.tipo === "directa", "a ficha do principal chega ao telemóvel", 30_000)
    expect(telemovel.vault.contents.fichasDosCanais?.[dm]).toEqual({ tipo: "directa", par: carla!.address })
  }, 120_000)

  it("uma comunidade de duas pessoas continua comunidade no emparelhado", async () => {
    const [ana, carla] = await contas("Ana", "Carla")
    const telemovel = await emparelharAparelho(ana!)
    abertas.push(telemovel)
    const interface_ = fichasDaInterface(telemovel)
    ana!.session.disconnect()

    const sala = moradaDeSala(servidor.casa)
    await carla!.session.createSpace(sala, undefined, "Duas pessoas")
    await carla!.session.seat(sala, ana!.address)
    await ate(() => telemovel.session.channels.includes(sala), "o telemóvel entra na comunidade", 30_000)
    await ate(() => Object.keys(telemovel.vault.contents.channelRooms[sala] ?? {}).length > 0, "as salas chegam", 30_000)
    await espera(500)
    expect(telemovel.session.tipoDoCanal(sala)).toBe("sala")
    expect(interface_()[sala]?.tipo ?? "sala").toBe("sala")
  }, 120_000)

  it("no aparelho com a chave de conta, um grupo de dois que não é a directa continua sala", async () => {
    const [ana, carla] = await contas("Ana", "Carla")
    // A bare group, with no rooms or name, with both accounts: it does not have the direct address.
    const canal = moradaDeSala(servidor.casa)
    await carla!.session.createSpaceChannel(canal)
    await carla!.session.seat(canal, ana!.address)
    await ate(() => ana!.session.channels.includes(canal), "a Ana entra", 30_000)
    await espera(500)
    expect(ana!.session.tipoDoCanal(canal)).toBe("sala")
  }, 120_000)
})
