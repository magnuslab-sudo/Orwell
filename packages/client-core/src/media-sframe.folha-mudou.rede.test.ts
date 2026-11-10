import { importSframeKey, leavesOf, SframeSender } from "@enclave/crypto"
import type { UserAddress } from "@enclave/protocol"
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import {
  ate,
  canalComTodos,
  contasDeTeste,
  desligarContas,
  levantarServidor,
  type ContaDeTeste,
  type ServidorDeTeste,
} from "../../../apps/server/testes/cliente-de-teste.js"
import { CifraDeMedia } from "./media-sframe.js"

/**
 * The person who switches sheets and goes silent (report from the owner, 3 November 2026).
 *
 * In the 22:31 log the owner joins the same voice room by SFU four times, and
 * the same three people give `sfu-receiver-without-encryption` each time. In
 * the server database those three accounts received several Welcome in the
 * Orwell channel (the re-seat: remove the sheet and give another), and a
 * re-seat in a channel with holes in the tree puts the person in a DIFFERENT
 * sheet: MLS gives the leftmost empty sheet.
 *
 * Encryption stores, per person, the chain of keys with the sheet (`senderId`)
 * where the key came from, and encryption is one for the life of the app.
 * Without a requested sheet, `receptorDe` only asked for sheets it already knew:
 * the old sheet is no longer theirs, the session answers `null`, and the
 * receiver has no encryption, even though the person is in the tree and their
 * messages decrypt.
 *
 * Accounts, sessions and server for real; only the media endpoints are from the test.
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

beforeEach(() => {
  // A Chromium browser: insertable streams. The endpoints bring their own flows.
  class Ponta {
    createEncodedStreams(): unknown {
      throw new Error("as pontas destes testes trazem os seus fluxos")
    }
  }
  vi.stubGlobal("RTCRtpSender", Ponta)
  vi.stubGlobal("RTCRtpReceiver", Ponta)
  return () => vi.unstubAllGlobals()
})

/** A media receiver with both endpoints under test control. */
function receptor(): { ponta: RTCRtpReceiver; empurrar: (bytes: Uint8Array) => void; saida: Uint8Array[] } {
  const saida: Uint8Array[] = []
  let controlador!: ReadableStreamDefaultController<{ data: ArrayBuffer }>
  const readable = new ReadableStream<{ data: ArrayBuffer }>({
    start(controller) {
      controlador = controller
    },
  })
  const writable = new WritableStream<{ data: ArrayBuffer }>({
    write(frame) {
      saida.push(new Uint8Array(frame.data))
    },
  })
  return {
    ponta: { createEncodedStreams: () => ({ readable, writable }) } as unknown as RTCRtpReceiver,
    saida,
    empurrar: (bytes) => controlador.enqueue({ data: bytes.slice().buffer as ArrayBuffer }),
  }
}

/** The media encryption for an account, with their session as the key source. */
function cifraDe(conta: ContaDeTeste, canal: string, diagnosticos: string[] = []): CifraDeMedia {
  const cifra = new CifraDeMedia(
    {
      selfAddress: conta.address as UserAddress,
      mediaKey: (c, address, folha) => conta.session.mediaKey(c, address, folha),
      reservarContadorSframe: (c, keyId) => conta.session.reservarContadorSframe(c, keyId),
    },
    (code) => diagnosticos.push(code),
  )
  cifra.canal = canal
  return cifra
}

const folhasDe = (quem: ContaDeTeste, em: ContaDeTeste, canal: string): number[] => {
  const grupo = em.session.groupFor(canal)
  return grupo ? leavesOf(grupo.state.ratchetTree, quem.address as UserAddress) : []
}

describe("uma pessoa que muda de folha no canal", () => {
  it("continua a ter chave de media, e o som dela abre", async () => {
    const [dono, bruno, carla] = await contasDeTeste(servidor, ["dono", "bruno", "carla"])
    abertas.push(dono!, bruno!, carla!)
    const canal = await canalComTodos(servidor, dono!, [bruno!, carla!])
    await ate(() => folhasDe(carla!, dono!, canal).length === 1, "a carla tem folha na árvore do dono")
    const folhaAntes = folhasDe(carla!, dono!, canal)[0]!

    // The owner hears carla on a call: encryption gets her chain.
    const diagnosticos: string[] = []
    const cifra = cifraDe(dono!, canal, diagnosticos)
    expect(await cifra.emissor()).toBeDefined()
    expect(await cifra.protegerReceptor(receptor().ponta, carla!.address as UserAddress)).toBe(true)

    // The channel opens a hole to carla's left, and carla is re-seated: she
    // leaves and returns, and MLS gives her the leftmost empty sheet.
    await dono!.session.expel(canal, bruno!.address)
    await dono!.session.expel(canal, carla!.address)
    await ate(() => folhasDe(carla!, dono!, canal).length === 0, "a carla saiu da árvore do dono")
    await dono!.session.seat(canal, carla!.address)
    await ate(() => folhasDe(carla!, dono!, canal).length === 1, "a carla voltou à árvore do dono")
    const folhaDepois = folhasDe(carla!, dono!, canal)[0]!
    await ate(() => folhasDe(carla!, carla!, canal)[0] === folhaDepois, "a carla abriu o Welcome")
    // The precondition for the bug: the sheet really did change.
    expect(folhaDepois).not.toBe(folhaAntes)

    // Carla is in the tree: the owner's session has a key for her.
    expect(await dono!.session.mediaKey(canal, carla!.address as UserAddress)).not.toBeNull()

    // The owner rejoins the room and the carla stream consumption restarts.
    // This is where `sfu-receptor-sem-cifra` was.
    const ponta = receptor()
    expect(await cifra.protegerReceptor(ponta.ponta, carla!.address as UserAddress)).toBe(true)
    // The rotation does not appear outside the channel (the `call-fora-do-canal` in telemetry).
    expect(await cifra.rodar([carla!.address as UserAddress])).toEqual([])

    // Carla speaks with the new sheet key, and the sound opens on the owner's side.
    const chaveDaCarla = await carla!.session.mediaKey(canal, carla!.address as UserAddress)
    if (!chaveDaCarla) throw new Error("a carla não tem chave própria")
    expect(chaveDaCarla.senderId).toBe(folhaDepois)
    const fala = new SframeSender(await importSframeKey(chaveDaCarla.material, chaveDaCarla.keyId, chaveDaCarla.senderId))
    for (let frame = 0; frame < 10; frame++) ponta.empurrar(await fala.encrypt(new Uint8Array([frame, 1, 2, 3])))
    await ate(() => ponta.saida.length === 10, "o som da carla abre do lado do dono", 5_000, 5)
    expect([...ponta.saida[0]!]).toEqual([0, 1, 2, 3])
  }, 90_000)
})
